import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export const createWineStockStore = (client, tableName = process.env.WINE_STOCK_TABLE_NAME) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!tableName) throw new Error('WINE_STOCK_TABLE_NAME is required');

    return {
        async listCurrentWinesByRetailer(retailerId) {
            const items = [];
            let exclusiveStartKey;

            do {
                const result = await client.send(new QueryCommand({
                    TableName: tableName,
                    IndexName: 'GSI1',
                    KeyConditionExpression: 'gsi1pk = :pk',
                    ExpressionAttributeValues: {
                        ':pk': `RETAILER#${ retailerId }#CURRENT`,
                    },
                    ExclusiveStartKey: exclusiveStartKey,
                }));

                items.push(...(result.Items ?? []));
                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return items;
        },

        async upsertWineListing({ retailerId, wine }) {
            await client.send(new UpdateCommand({
                TableName: tableName,
                ...createWineListingUpdate({ retailerId, wine }),
            }))
        },

        async upsertWineListings({ retailerId, wines }) {
            await Promise.all(wines.map(wine =>
                this.upsertWineListing({ retailerId, wine }))
            );
        },

        async markListingMissing({ retailerId, wineId, missingAt = new Date().toISOString() }) {
            await client.send(new UpdateCommand({
                TableName: tableName,
                Key: {
                    pk: `RETAILER#${ retailerId }`,
                    sk: `LISTING#${ wineId }`,
                },
                UpdateExpression: [
                    'SET isCurrent = :false',
                    'lastMissingAt = :missingAt',
                    'REMOVE gsi1pk, gsi1sk',
                ].join(' '),
                ExpressionAttributeValues: {
                    ':false': false,
                    ':missingAt': missingAt,
                }
            }));
        },

        async markListingsMissing({ retailerId, wines }) {
            const now = new Date().toISOString();
            await Promise.all(wines.map(wine =>
                this.markListingMissing({ retailerId, wineId: wine.id, missingAt: now }))
            );
        }
    };
};

const formatPrice = price => String(Number(price ?? 0).toFixed(2)).padStart(9, '0');

const createWineListingUpdate = ({ retailerId, wine }) => {
    const now = new Date().toISOString();
    const firstSeenAt = wine.firstSeenAt ?? now;
    const lastSeenAt = wine.lastSeenAt ?? now;
    const attributes = {
        entityType: 'RetailerListing',
        retailerId: retailerId,
        sourceKey: `retailer:${ retailerId }:${ wine.id }`,
        id: wine.id,
        name: wine.name,
        region: wine.region,
        vintage: wine.vintage,
        price: wine.price,
        grape: wine.grape,
        alcohol: wine.alcohol,
        description: wine.description,
        sourceHash: wine.sourceHash,
        rawPayload: wine.rawPayload,
        isCurrent: true,
        firstSeenAt,
        lastSeenAt,
        gsi1pk: `RETAILER#${ retailerId }#CURRENT`,
        gsi1sk: `PRICE#${ formatPrice(wine.price) }#LISTING#${ wine.id }`
    };

    const setExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    Object.entries(attributes)
        .filter(([, value]) => value !== undefined)
        .forEach(([name, value]) => {
            const nameKey = `#${ name }`;
            const valueKey = `:${ name }`;

            expressionAttributeNames[nameKey] = name;
            expressionAttributeValues[valueKey] = value;
            setExpressions.push(name === 'firstSeenAt'
                ? `${ nameKey } = if_not_exists(${ nameKey }, ${ valueKey })`
                : `${ nameKey } = ${ valueKey }`
            );
        });

    return {
        Key: {
            pk: `RETAILER#${ retailerId }`,
            sk: `LISTING#${ wine.id }`,
        },
        UpdateExpression: `SET ${ setExpressions.join(', ') } REMOVE #lastMissingAt`,
        ExpressionAttributeNames: {
            ...expressionAttributeNames,
            '#lastMissingAt': 'lastMissingAt',
        },
        ExpressionAttributeValues: expressionAttributeValues,
    };
}

import { PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const tableName = 'wine-stock';

export const createWineStockStore = client => {
    if (!client) throw new Error('DynamoDB client is required');

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
                        ':pk': `RETAILER#${retailerId}#CURRENT`,
                    },
                    ExclusiveStartKey: exclusiveStartKey,
                }));

                items.push(...(result.Items ?? []));
                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return items;
        },

        async upsertWineListing(wine) {
            await client.send(new PutCommand({
                TableName: tableName,
                Item: createWineListing(wine)
            }))
        },

        async upsertWineListings(wines) {
            await Promise.all(wines.map(wine =>
                this.upsertWineListing(wine))
            );
        },

        async markListingMissing({ retailerId, wineId, missingAt = new Date().toISOString() }) {
            await client.send(new UpdateCommand({
                TableName: tableName,
                Key: {
                    pk: `RETAILER#${retailerId}`,
                    sk: `LISTING#${wineId}`,
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

const createWineListing = wine => {
    const now = new Date().toISOString();

    return {
        pk: `RETAILER#${wine.retailerId}`,
        sk: `LISTING#${wine.id}`,

        entityType: 'RetailerListing',

        retailerId: wine.retailerId,
        sourceKey: `retailer:${wine.retailerId}:${wine.id}`,

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
        firstSeenAt: wine.firstSeenAt ?? now,
        lastSeenAt: now,

        gsi1pk: `RETAILER#${wine.retailerId}#CURRENT`,
        gsi1sk: `PRICE#${formatPrice(wine.price)}#LISTING#${wine.id}`
    };
}
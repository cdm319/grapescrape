import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ASSESSMENTS_BY_USER_INDEX = 'GSI1';
const ASSESSMENTS_BY_SOURCE_INDEX = 'GSI2';

export const createAssessmentHistoryStore = ({
    client,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
    wineStockTableName = process.env.WINE_STOCK_TABLE_NAME,
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!assessmentsTableName) throw new Error('ASSESSMENTS_TABLE_NAME is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');
    if (!wineStockTableName) throw new Error('WINE_STOCK_TABLE_NAME is required');

    return {
        async listCompletedAssessmentsByUser({ userId } = {}) {
            if (!userId) throw new Error('userId is required');

            return queryAll({
                client,
                input: {
                    TableName: assessmentsTableName,
                    IndexName: ASSESSMENTS_BY_USER_INDEX,
                    KeyConditionExpression: '#gsi1pk = :gsi1pk',
                    ExpressionAttributeNames: {
                        '#gsi1pk': 'gsi1pk',
                    },
                    ExpressionAttributeValues: {
                        ':gsi1pk': `USER#${ userId }#ASSESSMENTS`,
                    },
                },
            });
        },

        async listCompletedAssessmentsBySource({ userId, sourceKey } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!sourceKey) throw new Error('sourceKey is required');

            return queryAll({
                client,
                input: {
                    TableName: assessmentsTableName,
                    IndexName: ASSESSMENTS_BY_SOURCE_INDEX,
                    KeyConditionExpression: '#gsi2pk = :gsi2pk',
                    ExpressionAttributeNames: {
                        '#gsi2pk': 'gsi2pk',
                    },
                    ExpressionAttributeValues: {
                        ':gsi2pk': `USER#${ userId }#SOURCE#${ sourceKey }`,
                    },
                },
            });
        },

        async getCurrentPalateProfileVersion({ userId } = {}) {
            if (!userId) throw new Error('userId is required');

            const result = await client.send(new GetCommand({
                TableName: userDataTableName,
                Key: {
                    pk: `USER#${ userId }`,
                    sk: 'CURRENT_PALATE_PROFILE',
                },
                ProjectionExpression: '#palateProfileVersion',
                ExpressionAttributeNames: {
                    '#palateProfileVersion': 'palateProfileVersion',
                },
            }));

            return result.Item?.palateProfileVersion ?? null;
        },

        async getRetailerWineBySourceKey({ sourceKey } = {}) {
            const { retailerId, wineId } = parseRetailerSourceKey(sourceKey);
            const result = await client.send(new GetCommand({
                TableName: wineStockTableName,
                Key: {
                    pk: `RETAILER#${ retailerId }`,
                    sk: `LISTING#${ wineId }`,
                },
            }));

            return result.Item;
        },
    };
};

const queryAll = async ({ client, input }) => {
    const items = [];
    let exclusiveStartKey;

    do {
        const result = await client.send(new QueryCommand({
            ...input,
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }));

        items.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
};

const parseRetailerSourceKey = sourceKey => {
    if (typeof sourceKey !== 'string') {
        throw new Error('retailer sourceKey is required');
    }

    const match = /^retailer:([^:]+):(.+)$/.exec(sourceKey);

    if (!match) {
        throw new Error('retailer sourceKey is invalid');
    }

    return {
        retailerId: match[1],
        wineId: match[2],
    };
};

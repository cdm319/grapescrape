import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const CURRENT_WINES_INDEX = 'GSI1';
const ASSESSMENTS_BY_USER_INDEX = 'GSI1';
const ASSESSMENTS_BY_SOURCE_INDEX = 'GSI2';

export const createCatalogueStore = ({
    client,
    wineStockTableName = process.env.WINE_STOCK_TABLE_NAME,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!wineStockTableName) throw new Error('WINE_STOCK_TABLE_NAME is required');
    if (!assessmentsTableName) throw new Error('ASSESSMENTS_TABLE_NAME is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    return {
        async listCurrentWines({ retailerIds } = {}) {
            if (!Array.isArray(retailerIds)) {
                throw new Error('retailerIds is required');
            }

            const winesByRetailer = await Promise.all(retailerIds.map(retailerId =>
                listCurrentWinesByRetailer({
                    client,
                    tableName: wineStockTableName,
                    retailerId,
                })
            ));

            return winesByRetailer.flat();
        },

        async getCurrentWine({ retailerId, wineId } = {}) {
            if (!retailerId) throw new Error('retailerId is required');
            if (!wineId) throw new Error('wineId is required');

            const result = await client.send(new GetCommand({
                TableName: wineStockTableName,
                Key: {
                    pk: `RETAILER#${ retailerId }`,
                    sk: `LISTING#${ wineId }`,
                },
            }));

            if (result.Item?.isCurrent !== true) {
                return undefined;
            }

            return result.Item;
        },

        async getLatestCompletedAssessment({ userId, sourceKey } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!sourceKey) throw new Error('sourceKey is required');

            const assessments = [];
            let exclusiveStartKey;

            do {
                const result = await client.send(new QueryCommand({
                    TableName: assessmentsTableName,
                    IndexName: ASSESSMENTS_BY_SOURCE_INDEX,
                    KeyConditionExpression: '#gsi2pk = :gsi2pk',
                    FilterExpression: '#status = :completed',
                    ExpressionAttributeNames: {
                        '#gsi2pk': 'gsi2pk',
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':gsi2pk': `USER#${ userId }#SOURCE#${ sourceKey }`,
                        ':completed': 'completed',
                    },
                    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                }));

                assessments.push(...(result.Items ?? []));
                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return assessments.reduce(selectLaterAssessment, undefined);
        },

        async getLatestCompletedAssessments({ userId, sourceKeys } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!Array.isArray(sourceKeys)) throw new Error('sourceKeys is required');

            const requestedSourceKeys = new Set(sourceKeys);
            const latestBySourceKey = new Map();
            let exclusiveStartKey;

            if (requestedSourceKeys.size === 0) {
                return latestBySourceKey;
            }

            do {
                const result = await client.send(new QueryCommand({
                    TableName: assessmentsTableName,
                    IndexName: ASSESSMENTS_BY_USER_INDEX,
                    KeyConditionExpression: '#gsi1pk = :gsi1pk',
                    FilterExpression: '#status = :completed',
                    ExpressionAttributeNames: {
                        '#gsi1pk': 'gsi1pk',
                        '#status': 'status',
                    },
                    ExpressionAttributeValues: {
                        ':gsi1pk': `USER#${ userId }#ASSESSMENTS`,
                        ':completed': 'completed',
                    },
                    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
                }));

                for (const assessment of result.Items ?? []) {
                    if (!requestedSourceKeys.has(assessment.sourceKey)) {
                        continue;
                    }

                    latestBySourceKey.set(
                        assessment.sourceKey,
                        selectLaterAssessment(
                            latestBySourceKey.get(assessment.sourceKey),
                            assessment,
                        ),
                    );
                }

                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return latestBySourceKey;
        },

        async getCurrentPalateProfileVersion(userId) {
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
    };
};

const listCurrentWinesByRetailer = async ({
    client,
    tableName,
    retailerId,
}) => {
    const wines = [];
    let exclusiveStartKey;

    do {
        const result = await client.send(new QueryCommand({
            TableName: tableName,
            IndexName: CURRENT_WINES_INDEX,
            KeyConditionExpression: '#gsi1pk = :gsi1pk',
            ExpressionAttributeNames: {
                '#gsi1pk': 'gsi1pk',
            },
            ExpressionAttributeValues: {
                ':gsi1pk': `RETAILER#${ retailerId }#CURRENT`,
            },
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }));

        wines.push(...(result.Items ?? []).filter(item => item.isCurrent === true));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return wines;
};

const selectLaterAssessment = (selected, candidate) => {
    if (!selected) {
        validateAssessmentVersion(candidate);
        return candidate;
    }

    const selectedVersion = validateAssessmentVersion(selected);
    const candidateVersion = validateAssessmentVersion(candidate);

    if (candidateVersion !== selectedVersion) {
        return candidateVersion > selectedVersion ? candidate : selected;
    }

    const completedAtComparison = compareStrings(
        String(candidate.completedAt ?? ''),
        String(selected.completedAt ?? ''),
    );

    if (completedAtComparison !== 0) {
        return completedAtComparison > 0 ? candidate : selected;
    }

    return compareStrings(
        String(candidate.assessmentInputKey ?? ''),
        String(selected.assessmentInputKey ?? ''),
    ) > 0
        ? candidate
        : selected;
};

const compareStrings = (left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
};

const validateAssessmentVersion = assessment => {
    const assessmentVersion = assessment.assessmentVersion ?? 1;

    if (!Number.isSafeInteger(assessmentVersion) || assessmentVersion < 1) {
        throw new Error('Completed assessment has an invalid assessmentVersion');
    }

    return assessmentVersion;
};

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

export const createAssessmentStore = ({
    client,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!assessmentsTableName) throw new Error('ASSESSMENTS_TABLE_NAME is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    return {
        async getCurrentPalateProfile(userId) {
            const pointer = await getItem({
                client,
                tableName: userDataTableName,
                key: {
                    pk: `USER#${ userId }`,
                    sk: 'CURRENT_PALATE_PROFILE',
                },
            });

            if (!pointer) return undefined;

            const profileSk = pointer.palateProfileSk ?? (
                pointer.palateProfileVersion === undefined
                    ? undefined
                    : `PALATE_PROFILE#${ pointer.palateProfileVersion }`
            );

            if (!profileSk) {
                throw new Error(`Current palate profile pointer is missing palateProfileSk for userId=${ userId }`);
            }

            const profile = await getItem({
                client,
                tableName: userDataTableName,
                key: {
                    pk: `USER#${ userId }`,
                    sk: profileSk,
                },
            });

            if (!profile) return undefined;

            return {
                ...profile,
                currentPointer: pointer,
            };
        },

        async getAssessmentByInputKey({ userId, assessmentInputKey }) {
            return getItem({
                client,
                tableName: assessmentsTableName,
                key: createAssessmentKey({ userId, assessmentInputKey }),
            });
        },

        async putCompletedAssessment(item) {
            try {
                await client.send(new PutCommand({
                    TableName: assessmentsTableName,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                }));
            } catch (error) {
                if (error.name === 'ConditionalCheckFailedException') {
                    throw createCompletedAssessmentConflictError({
                        userId: item.userId,
                        assessmentInputKey: item.assessmentInputKey,
                    });
                }

                throw error;
            }
        },
    };
};

export const buildCompletedAssessmentItem = ({
    userId,
    assessmentInputKey,
    source,
    wineSnapshot,
    sourceHash,
    palateProfileVersion,
    assessmentVersion,
    model,
    assessment,
    createdAt = new Date().toISOString(),
    completedAt = createdAt,
}) => {
    const sourceKey = source?.key;
    const { retailerId, wineId } = getRetailerSourceParts(source);

    return {
        pk: `USER#${ userId }`,
        sk: `ASSESSMENT#${ assessmentInputKey }`,
        entityType: 'Assessment',

        userId,
        assessmentInputKey,

        source,
        sourceKey,
        retailerId,
        wineId,

        wineSnapshot,

        sourceHash,
        palateProfileVersion,
        assessmentVersion,

        status: 'completed',
        model,
        assessment,

        fit: assessment.fit,
        highlight: assessment.highlight,
        confidence: assessment.confidence,
        headline: assessment.headline ?? null,
        summary: assessment.summary ?? null,

        createdAt,
        completedAt,

        gsi1pk: `USER#${ userId }#ASSESSMENTS`,
        gsi1sk: `CREATED#${ createdAt }#ASSESSMENT#${ assessmentInputKey }`,

        gsi2pk: `USER#${ userId }#SOURCE#${ sourceKey }`,
        gsi2sk: `CREATED#${ createdAt }#ASSESSMENT#${ assessmentInputKey }`,
    };
};

export const isCompletedAssessmentConflict = error =>
    error?.name === 'CompletedAssessmentConflictError'
    || error?.isConditionalConflict === true;

const createCompletedAssessmentConflictError = ({ userId, assessmentInputKey }) => {
    const error = new Error(
        `Completed assessment already exists for userId=${ userId } assessmentInputKey=${ assessmentInputKey }`
    );
    error.name = 'CompletedAssessmentConflictError';
    error.userId = userId;
    error.assessmentInputKey = assessmentInputKey;
    error.isConditionalConflict = true;
    return error;
};

const getItem = async ({ client, tableName, key }) => {
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: key,
    }));

    return result.Item;
};

const createAssessmentKey = ({ userId, assessmentInputKey }) => ({
    pk: `USER#${ userId }`,
    sk: `ASSESSMENT#${ assessmentInputKey }`,
});

const getRetailerSourceParts = source => {
    if (source?.type !== 'retailer') {
        return {};
    }

    const [, retailerId, wineId] = source.key.split(':');

    return { retailerId, wineId };
};

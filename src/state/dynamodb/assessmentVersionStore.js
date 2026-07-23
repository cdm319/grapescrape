import {
    PutCommand,
    QueryCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ASSESSMENTS_BY_SOURCE_INDEX = 'GSI2';
const ASSESSMENT_VERSION_COUNTER = 'AssessmentVersionCounter';
const MAX_ALLOCATION_ATTEMPTS = 3;

export const createAssessmentVersionStore = ({
    client,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!assessmentsTableName) throw new Error('ASSESSMENTS_TABLE_NAME is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    return {
        async allocateNextAssessmentVersion({ userId, sourceKey } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!sourceKey) throw new Error('sourceKey is required');

            const counterKey = createCounterKey({ userId, sourceKey });

            for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
                const incrementedVersion = await incrementExistingCounter({
                    client,
                    tableName: userDataTableName,
                    counterKey,
                });

                if (incrementedVersion !== undefined) {
                    return incrementedVersion;
                }

                const historicalMaximum = await getHistoricalMaximum({
                    client,
                    tableName: assessmentsTableName,
                    userId,
                    sourceKey,
                });
                const initialVersion = historicalMaximum + 1;
                const counterCreated = await createInitialCounter({
                    client,
                    tableName: userDataTableName,
                    counterKey,
                    userId,
                    sourceKey,
                    initialVersion,
                });

                if (counterCreated) {
                    return initialVersion;
                }
            }

            throw createAllocationConflictError({
                userId,
                sourceKey,
            });
        },
    };
};

const incrementExistingCounter = async ({
    client,
    tableName,
    counterKey,
}) => {
    try {
        const result = await client.send(new UpdateCommand({
            TableName: tableName,
            Key: counterKey,
            UpdateExpression: [
                'SET #latestAssessmentVersion = #latestAssessmentVersion + :increment',
                '#updatedAt = :updatedAt',
            ].join(', '),
            ConditionExpression: [
                '#entityType = :entityType',
                'attribute_exists(#latestAssessmentVersion)',
            ].join(' AND '),
            ExpressionAttributeNames: {
                '#entityType': 'entityType',
                '#latestAssessmentVersion': 'latestAssessmentVersion',
                '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
                ':entityType': ASSESSMENT_VERSION_COUNTER,
                ':increment': 1,
                ':updatedAt': new Date().toISOString(),
            },
            ReturnValues: 'UPDATED_NEW',
        }));

        const allocatedVersion = result.Attributes?.latestAssessmentVersion;

        if (!Number.isSafeInteger(allocatedVersion) || allocatedVersion < 1) {
            throw new Error('Assessment version counter returned an invalid version');
        }

        return allocatedVersion;
    } catch (error) {
        if (isConditionalConflict(error)) {
            return undefined;
        }

        throw error;
    }
};

const getHistoricalMaximum = async ({
    client,
    tableName,
    userId,
    sourceKey,
}) => {
    let exclusiveStartKey;
    let historicalMaximum = 0;

    do {
        const result = await client.send(new QueryCommand({
            TableName: tableName,
            IndexName: ASSESSMENTS_BY_SOURCE_INDEX,
            KeyConditionExpression: '#gsi2pk = :gsi2pk',
            ExpressionAttributeNames: {
                '#gsi2pk': 'gsi2pk',
                '#assessmentVersion': 'assessmentVersion',
            },
            ExpressionAttributeValues: {
                ':gsi2pk': `USER#${ userId }#SOURCE#${ sourceKey }`,
            },
            ProjectionExpression: '#assessmentVersion',
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }));

        for (const item of result.Items ?? []) {
            const assessmentVersion = getHistoricalAssessmentVersion(item);
            historicalMaximum = Math.max(historicalMaximum, assessmentVersion);
        }

        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return historicalMaximum;
};

const getHistoricalAssessmentVersion = item => {
    if (item.assessmentVersion === undefined) {
        return 1;
    }

    if (!Number.isSafeInteger(item.assessmentVersion) || item.assessmentVersion < 1) {
        throw new Error('Historical assessment has an invalid assessmentVersion');
    }

    return item.assessmentVersion;
};

const createInitialCounter = async ({
    client,
    tableName,
    counterKey,
    userId,
    sourceKey,
    initialVersion,
}) => {
    const timestamp = new Date().toISOString();

    try {
        await client.send(new PutCommand({
            TableName: tableName,
            Item: {
                ...counterKey,
                entityType: ASSESSMENT_VERSION_COUNTER,
                userId,
                sourceKey,
                latestAssessmentVersion: initialVersion,
                createdAt: timestamp,
                updatedAt: timestamp,
            },
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }));

        return true;
    } catch (error) {
        if (isConditionalConflict(error)) {
            return false;
        }

        throw error;
    }
};

const createCounterKey = ({ userId, sourceKey }) => ({
    pk: `USER#${ userId }`,
    sk: `ASSESSMENT_VERSION#${ encodeURIComponent(sourceKey) }`,
});

const createAllocationConflictError = ({ userId, sourceKey }) => {
    const error = new Error(
        `Unable to allocate assessment version after ${ MAX_ALLOCATION_ATTEMPTS } attempts`
    );
    error.name = 'AssessmentVersionAllocationConflictError';
    error.userId = userId;
    error.sourceKey = sourceKey;
    error.attempts = MAX_ALLOCATION_ATTEMPTS;
    error.isConditionalConflict = true;
    return error;
};

const isConditionalConflict = error =>
    error?.name === 'ConditionalCheckFailedException';

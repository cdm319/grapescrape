import {
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ASSESSMENTS_BY_SOURCE_INDEX = 'GSI2';
const ASSESSMENT_VERSION_COUNTER = 'AssessmentVersionCounter';
const MAX_ALLOCATION_ATTEMPTS = 3;

export const createAssessmentVersionStore = ({
    client,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
    now = () => new Date().toISOString(),
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!assessmentsTableName) throw new Error('ASSESSMENTS_TABLE_NAME is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    return {
        async allocateNextAssessmentVersions({ userId, sourceKeys } = {}) {
            validateBulkAllocationInput({ userId, sourceKeys });

            for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
                const counters = await Promise.all(sourceKeys.map(sourceKey =>
                    getCounter({
                        client,
                        tableName: userDataTableName,
                        userId,
                        sourceKey,
                    })
                ));
                const historicalMaximums = await Promise.all(counters.map((counter, index) =>
                    counter
                        ? undefined
                        : getHistoricalMaximum({
                            client,
                            tableName: assessmentsTableName,
                            userId,
                            sourceKey: sourceKeys[index],
                        })
                ));
                const allocations = sourceKeys.map((sourceKey, index) => ({
                    sourceKey,
                    assessmentVersion: counters[index]
                        ? counters[index].latestAssessmentVersion + 1
                        : historicalMaximums[index] + 1,
                }));
                const timestamp = now();

                try {
                    await client.send(new TransactWriteCommand({
                        TransactItems: allocations.map((allocation, index) =>
                            counters[index]
                                ? createCounterUpdate({
                                    tableName: userDataTableName,
                                    userId,
                                    sourceKey: allocation.sourceKey,
                                    currentVersion: counters[index].latestAssessmentVersion,
                                    nextVersion: allocation.assessmentVersion,
                                    timestamp,
                                })
                                : createCounterPut({
                                    tableName: userDataTableName,
                                    userId,
                                    sourceKey: allocation.sourceKey,
                                    initialVersion: allocation.assessmentVersion,
                                    timestamp,
                                })
                        ),
                    }));

                    return allocations;
                } catch (error) {
                    if (!isBulkAllocationConflict(error)) throw error;
                }
            }

            throw createBulkAllocationConflictError({ userId, sourceKeys });
        },

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

const validateBulkAllocationInput = ({ userId, sourceKeys }) => {
    if (!userId) throw new Error('userId is required');
    if (!Array.isArray(sourceKeys)) throw new Error('sourceKeys is required');
    if (sourceKeys.length < 1 || sourceKeys.length > 25) {
        throw new Error('sourceKeys must contain between 1 and 25 items');
    }
    if (sourceKeys.some(sourceKey => typeof sourceKey !== 'string' || !sourceKey)) {
        throw new Error('sourceKeys must contain non-empty strings');
    }
    if (new Set(sourceKeys).size !== sourceKeys.length) {
        throw new Error('sourceKeys must be unique');
    }
};

const getCounter = async ({
    client,
    tableName,
    userId,
    sourceKey,
}) => {
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: createCounterKey({ userId, sourceKey }),
        ConsistentRead: true,
    }));

    if (!result.Item) return undefined;
    if (
        result.Item.entityType !== ASSESSMENT_VERSION_COUNTER
        || result.Item.userId !== userId
        || result.Item.sourceKey !== sourceKey
        || !Number.isSafeInteger(result.Item.latestAssessmentVersion)
        || result.Item.latestAssessmentVersion < 1
        || result.Item.latestAssessmentVersion === Number.MAX_SAFE_INTEGER
    ) {
        throw new Error('Assessment version counter is invalid');
    }

    return result.Item;
};

const createCounterUpdate = ({
    tableName,
    userId,
    sourceKey,
    currentVersion,
    nextVersion,
    timestamp,
}) => ({
    Update: {
        TableName: tableName,
        Key: createCounterKey({ userId, sourceKey }),
        UpdateExpression: [
            'SET #latestAssessmentVersion = :nextVersion',
            '#updatedAt = :updatedAt',
        ].join(', '),
        ConditionExpression: [
            '#entityType = :entityType',
            '#latestAssessmentVersion = :currentVersion',
        ].join(' AND '),
        ExpressionAttributeNames: {
            '#entityType': 'entityType',
            '#latestAssessmentVersion': 'latestAssessmentVersion',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':entityType': ASSESSMENT_VERSION_COUNTER,
            ':currentVersion': currentVersion,
            ':nextVersion': nextVersion,
            ':updatedAt': timestamp,
        },
    },
});

const createCounterPut = ({
    tableName,
    userId,
    sourceKey,
    initialVersion,
    timestamp,
}) => ({
    Put: {
        TableName: tableName,
        Item: {
            ...createCounterKey({ userId, sourceKey }),
            entityType: ASSESSMENT_VERSION_COUNTER,
            userId,
            sourceKey,
            latestAssessmentVersion: initialVersion,
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    },
});

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

    if (
        !Number.isSafeInteger(item.assessmentVersion)
        || item.assessmentVersion < 1
        || item.assessmentVersion === Number.MAX_SAFE_INTEGER
    ) {
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

const createBulkAllocationConflictError = ({ userId, sourceKeys }) => {
    const error = new Error(
        `Unable to allocate assessment versions after ${ MAX_ALLOCATION_ATTEMPTS } attempts`
    );
    error.name = 'AssessmentVersionAllocationConflictError';
    error.userId = userId;
    error.sourceKeys = [...sourceKeys];
    error.attempts = MAX_ALLOCATION_ATTEMPTS;
    error.isConditionalConflict = true;
    return error;
};

const isBulkAllocationConflict = error => {
    if (
        error?.name === 'ConditionalCheckFailedException'
        || error?.name === 'TransactionConflictException'
    ) {
        return true;
    }
    if (error?.name !== 'TransactionCanceledException') return false;

    const cancellationReasons = error.CancellationReasons
        ?? error.cancellationReasons
        ?? [];

    return cancellationReasons.some(reason =>
        reason?.Code === 'ConditionalCheckFailed'
        || reason?.Code === 'TransactionConflict'
    );
};

const isConditionalConflict = error =>
    error?.name === 'ConditionalCheckFailedException';

import { createHash } from 'node:crypto';
import {
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const MANUAL_WINE_PREFIX = 'MANUAL_WINE#';
const MANUAL_WINE_IDENTITY_PREFIX = 'MANUAL_WINE_IDENTITY#';
const MANUAL_WINE_ENTITY_TYPE = 'ManualWine';
const MANUAL_WINE_IDENTITY_ENTITY_TYPE = 'ManualWineIdentity';
const CURRENT_PALATE_PROFILE_SK = 'CURRENT_PALATE_PROFILE';
const ASSESSMENTS_BY_SOURCE_INDEX = 'GSI2';
const MAX_CREATE_ATTEMPTS = 3;
const MANUAL_SOURCE_KEY_PATTERN = /^manual:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const createManualWineStore = ({
    client,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
    now = () => new Date().toISOString(),
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    const getManualWineById = async ({ userId, manualWineId }) => {
        if (!userId) throw new Error('userId is required');
        if (!manualWineId) throw new Error('manualWineId is required');

        const result = await client.send(new GetCommand({
            TableName: userDataTableName,
            Key: manualWineKey({ userId, manualWineId }),
            ConsistentRead: true,
        }));

        return result.Item
            ? toManualWineRecord(result.Item)
            : undefined;
    };

    return {
        async createManualWine({
            userId,
            manualWineId,
            name,
            vintage,
            description,
            identity,
            sourceHash,
        } = {}) {
            requireManualWineInput({
                userId,
                manualWineId,
                name,
                vintage,
                description,
                identity,
                sourceHash,
            });

            const timestamp = now();
            const sourceKey = `manual:${ manualWineId }`;
            const item = {
                ...manualWineKey({ userId, manualWineId }),
                entityType: MANUAL_WINE_ENTITY_TYPE,
                userId,
                manualWineId,
                source: {
                    type: 'manual',
                    key: sourceKey,
                },
                sourceKey,
                name,
                vintage,
                description,
                status: 'active',
                isActive: true,
                deletedAt: null,
                sourceHash,
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            const identityItem = {
                pk: userPartitionKey(userId),
                sk: manualWineIdentityKey(identity),
                entityType: MANUAL_WINE_IDENTITY_ENTITY_TYPE,
                userId,
                manualWineId,
                sourceKey,
                createdAt: timestamp,
            };

            for (
                let attempt = 1;
                attempt <= MAX_CREATE_ATTEMPTS;
                attempt += 1
            ) {
                try {
                    await client.send(new TransactWriteCommand({
                        TransactItems: [
                            {
                                Put: {
                                    TableName: userDataTableName,
                                    Item: item,
                                    ConditionExpression: [
                                        'attribute_not_exists(pk)',
                                        'attribute_not_exists(sk)',
                                    ].join(' AND '),
                                },
                            },
                            {
                                Put: {
                                    TableName: userDataTableName,
                                    Item: identityItem,
                                    ConditionExpression: [
                                        'attribute_not_exists(pk)',
                                        'attribute_not_exists(sk)',
                                    ].join(' AND '),
                                },
                            },
                        ],
                    }));
                    return toManualWineRecord(item);
                } catch (error) {
                    if (
                        !isConditionalConflict(error)
                        && !isTransactionConflict(error)
                    ) {
                        throw error;
                    }

                    const identityReservation = await getIdentityReservation({
                        client,
                        tableName: userDataTableName,
                        key: {
                            pk: identityItem.pk,
                            sk: identityItem.sk,
                        },
                    });

                    if (identityReservation) {
                        throw createExpectedError({
                            name: 'ManualWineAlreadyExistsError',
                            userId,
                            manualWineId:
                                identityReservation.manualWineId
                                ?? manualWineId,
                        });
                    }

                    if (
                        isConditionalConflict(error)
                        || attempt === MAX_CREATE_ATTEMPTS
                    ) {
                        throw error;
                    }
                }
            }
        },

        async listActiveManualWines(userId) {
            if (!userId) throw new Error('userId is required');

            const records = [];
            let exclusiveStartKey;

            do {
                const result = await client.send(new QueryCommand({
                    TableName: userDataTableName,
                    KeyConditionExpression: [
                        '#pk = :pk',
                        'begins_with(#sk, :manualWinePrefix)',
                    ].join(' AND '),
                    ExpressionAttributeNames: {
                        '#pk': 'pk',
                        '#sk': 'sk',
                    },
                    ExpressionAttributeValues: {
                        ':pk': userPartitionKey(userId),
                        ':manualWinePrefix': MANUAL_WINE_PREFIX,
                    },
                    ConsistentRead: true,
                    ...(exclusiveStartKey
                        ? { ExclusiveStartKey: exclusiveStartKey }
                        : {}),
                }));

                for (const item of result.Items ?? []) {
                    const record = toManualWineRecord(item);

                    if (record.status === 'active') {
                        records.push(record);
                    }
                }

                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return records;
        },

        getManualWineById,

        async getManualWineBySourceKey({ userId, sourceKey } = {}) {
            if (!userId) throw new Error('userId is required');
            if (typeof sourceKey !== 'string') return undefined;

            const match = MANUAL_SOURCE_KEY_PATTERN.exec(sourceKey);

            if (!match) return undefined;

            return getManualWineById({
                userId,
                manualWineId: match[1],
            });
        },

        async getCurrentPalateProfileVersion(userId) {
            if (!userId) throw new Error('userId is required');

            const result = await client.send(new GetCommand({
                TableName: userDataTableName,
                Key: {
                    pk: userPartitionKey(userId),
                    sk: CURRENT_PALATE_PROFILE_SK,
                },
                ConsistentRead: true,
            }));
            const version = result.Item?.palateProfileVersion;

            if (version === undefined) return null;
            if (!Number.isSafeInteger(version) || version < 1) {
                throw new Error('Current palate profile pointer has an invalid version');
            }

            return version;
        },

        async updateManualWineDescription({
            userId,
            manualWineId,
            description,
            sourceHash,
        } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!manualWineId) throw new Error('manualWineId is required');
            if (typeof description !== 'string') {
                throw new Error('description is required');
            }
            if (!sourceHash) throw new Error('sourceHash is required');

            try {
                const result = await client.send(new UpdateCommand({
                    TableName: userDataTableName,
                    Key: manualWineKey({ userId, manualWineId }),
                    UpdateExpression: [
                        'SET #description = :description',
                        '#sourceHash = :sourceHash',
                        '#updatedAt = :updatedAt',
                    ].join(', '),
                    ConditionExpression: [
                        '#entityType = :entityType',
                        '#status = :active',
                    ].join(' AND '),
                    ExpressionAttributeNames: {
                        '#entityType': 'entityType',
                        '#status': 'status',
                        '#description': 'description',
                        '#sourceHash': 'sourceHash',
                        '#updatedAt': 'updatedAt',
                    },
                    ExpressionAttributeValues: {
                        ':entityType': MANUAL_WINE_ENTITY_TYPE,
                        ':active': 'active',
                        ':description': description,
                        ':sourceHash': sourceHash,
                        ':updatedAt': now(),
                    },
                    ReturnValues: 'ALL_NEW',
                }));

                return toManualWineRecord(result.Attributes);
            } catch (error) {
                if (!isConditionalConflict(error)) throw error;

                return handleInactiveRecord({
                    record: await getManualWineById({
                        userId,
                        manualWineId,
                    }),
                    userId,
                    manualWineId,
                    conflict: error,
                });
            }
        },

        async softDeleteManualWine({ userId, manualWineId } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!manualWineId) throw new Error('manualWineId is required');

            const timestamp = now();

            try {
                const result = await client.send(new UpdateCommand({
                    TableName: userDataTableName,
                    Key: manualWineKey({ userId, manualWineId }),
                    UpdateExpression: [
                        'SET #status = :deleted',
                        '#isActive = :false',
                        '#deletedAt = :deletedAt',
                        '#updatedAt = :updatedAt',
                    ].join(', '),
                    ConditionExpression: [
                        '#entityType = :entityType',
                        '#status = :active',
                    ].join(' AND '),
                    ExpressionAttributeNames: {
                        '#entityType': 'entityType',
                        '#status': 'status',
                        '#isActive': 'isActive',
                        '#deletedAt': 'deletedAt',
                        '#updatedAt': 'updatedAt',
                    },
                    ExpressionAttributeValues: {
                        ':entityType': MANUAL_WINE_ENTITY_TYPE,
                        ':active': 'active',
                        ':deleted': 'deleted',
                        ':false': false,
                        ':deletedAt': timestamp,
                        ':updatedAt': timestamp,
                    },
                    ReturnValues: 'ALL_NEW',
                }));

                return toManualWineRecord(result.Attributes);
            } catch (error) {
                if (!isConditionalConflict(error)) throw error;

                const record = await getManualWineById({
                    userId,
                    manualWineId,
                });

                if (!record) {
                    throw createExpectedError({
                        name: 'ManualWineNotFoundError',
                        userId,
                        manualWineId,
                    });
                }
                if (record.status === 'deleted') {
                    return record;
                }

                throw error;
            }
        },
    };
};

export const createManualWineAssessmentReadStore = ({
    client,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!assessmentsTableName) {
        throw new Error('ASSESSMENTS_TABLE_NAME is required');
    }

    return {
        async getHighestCompletedAssessment({ userId, sourceKey } = {}) {
            if (!userId) throw new Error('userId is required');
            if (!sourceKey) throw new Error('sourceKey is required');

            let highest;
            let exclusiveStartKey;

            do {
                const result = await client.send(new QueryCommand({
                    TableName: assessmentsTableName,
                    IndexName: ASSESSMENTS_BY_SOURCE_INDEX,
                    KeyConditionExpression: '#gsi2pk = :gsi2pk',
                    ExpressionAttributeNames: {
                        '#gsi2pk': 'gsi2pk',
                    },
                    ExpressionAttributeValues: {
                        ':gsi2pk': `USER#${ userId }#SOURCE#${ sourceKey }`,
                    },
                    ...(exclusiveStartKey
                        ? { ExclusiveStartKey: exclusiveStartKey }
                        : {}),
                }));

                for (const item of result.Items ?? []) {
                    if (item.status !== 'completed') continue;

                    const version = completedAssessmentVersion(item);

                    if (
                        !highest
                        || version > completedAssessmentVersion(highest)
                        || (
                            version === completedAssessmentVersion(highest)
                            && (item.completedAt ?? '') > (highest.completedAt ?? '')
                        )
                    ) {
                        highest = item;
                    }
                }

                exclusiveStartKey = result.LastEvaluatedKey;
            } while (exclusiveStartKey);

            return highest;
        },
    };
};

export const isManualWineAlreadyExists = error =>
    error?.name === 'ManualWineAlreadyExistsError';

export const isManualWineNotFound = error =>
    error?.name === 'ManualWineNotFoundError';

export const isManualWineDeleted = error =>
    error?.name === 'ManualWineDeletedError';

const requireManualWineInput = input => {
    for (const field of [
        'userId',
        'manualWineId',
        'name',
        'vintage',
        'description',
        'identity',
        'sourceHash',
    ]) {
        if (
            input[field] === undefined
            || input[field] === null
        ) {
            throw new Error(`${ field } is required`);
        }
    }
};

const handleInactiveRecord = ({
    record,
    userId,
    manualWineId,
    conflict,
}) => {
    if (!record) {
        throw createExpectedError({
            name: 'ManualWineNotFoundError',
            userId,
            manualWineId,
        });
    }
    if (record.status === 'deleted') {
        throw createExpectedError({
            name: 'ManualWineDeletedError',
            userId,
            manualWineId,
        });
    }

    throw conflict;
};

const toManualWineRecord = item => {
    if (item?.entityType !== MANUAL_WINE_ENTITY_TYPE) {
        throw new Error('Stored manual wine has an invalid entity type');
    }

    return {
        userId: item.userId,
        id: item.manualWineId,
        sourceKey: item.sourceKey,
        source: {
            type: 'manual',
            key: item.sourceKey,
        },
        name: item.name,
        vintage: item.vintage,
        description: item.description,
        status: item.status,
        isActive: item.isActive ?? item.status === 'active',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        deletedAt: item.deletedAt ?? null,
        sourceHash: item.sourceHash,
    };
};

const manualWineKey = ({ userId, manualWineId }) => ({
    pk: userPartitionKey(userId),
    sk: `${ MANUAL_WINE_PREFIX }${ manualWineId }`,
});

const userPartitionKey = userId => `USER#${ userId }`;

const manualWineIdentityKey = identity =>
    `${ MANUAL_WINE_IDENTITY_PREFIX }${ createHash('sha256')
        .update(identity)
        .digest('hex') }`;

const completedAssessmentVersion = item => {
    const version = item.assessmentVersion ?? 1;

    if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error('Completed assessment has an invalid assessmentVersion');
    }

    return version;
};

const createExpectedError = ({
    name,
    userId,
    manualWineId,
}) => {
    const error = new Error(name);
    error.name = name;
    error.userId = userId;
    error.manualWineId = manualWineId;
    return error;
};

const isConditionalConflict = error => {
    if (error?.name === 'ConditionalCheckFailedException') return true;
    if (error?.name !== 'TransactionCanceledException') return false;

    const cancellationReasons =
        error.CancellationReasons
        ?? error.cancellationReasons
        ?? [];

    return cancellationReasons.some(
        reason => reason?.Code === 'ConditionalCheckFailed',
    );
};

const isTransactionConflict = error => {
    if (error?.name === 'TransactionConflictException') return true;
    if (error?.name !== 'TransactionCanceledException') return false;

    const cancellationReasons =
        error.CancellationReasons
        ?? error.cancellationReasons
        ?? [];

    return cancellationReasons.some(
        reason => reason?.Code === 'TransactionConflict',
    );
};

const getIdentityReservation = async ({
    client,
    tableName,
    key,
}) => {
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: key,
        ConsistentRead: true,
    }));

    return result.Item;
};

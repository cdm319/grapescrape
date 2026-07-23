import {
    GetCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const CURRENT_POINTER_SK = 'CURRENT_PALATE_PROFILE';
const PROFILE_SK_PREFIX = 'PALATE_PROFILE#';
const PROFILE_ENTITY_TYPE = 'PalateProfile';
const POINTER_ENTITY_TYPE = 'CurrentPalateProfilePointer';

export const createPalateProfileStore = ({
    client,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
    now = () => new Date().toISOString(),
} = {}) => {
    if (!client) throw new Error('DynamoDB client is required');
    if (!userDataTableName) throw new Error('USER_DATA_TABLE_NAME is required');

    return {
        async getCurrentPalateProfile(userId) {
            if (!userId) throw new Error('userId is required');

            const pointer = await getCurrentPointer({
                client,
                tableName: userDataTableName,
                userId,
            });

            if (!pointer) return undefined;

            const profileSk = pointer.palateProfileSk ?? (
                pointer.palateProfileVersion === undefined
                    ? undefined
                    : `${ PROFILE_SK_PREFIX }${ pointer.palateProfileVersion }`
            );

            if (!profileSk) {
                throw new Error('Current palate profile pointer is missing its profile key');
            }

            const result = await client.send(new GetCommand({
                TableName: userDataTableName,
                Key: {
                    pk: userPartitionKey(userId),
                    sk: profileSk,
                },
                ConsistentRead: true,
            }));

            if (!result.Item) {
                throw new Error('Current palate profile version was not found');
            }

            return toPublicPalateProfile(result.Item);
        },

        async putNextPalateProfile({
            userId,
            expectedPalateProfileVersion,
            profile,
        } = {}) {
            if (!userId) throw new Error('userId is required');
            if (
                expectedPalateProfileVersion !== null
                && (
                    !Number.isSafeInteger(expectedPalateProfileVersion)
                    || expectedPalateProfileVersion < 1
                )
            ) {
                throw new Error('expectedPalateProfileVersion must be null or a positive integer');
            }
            if (!profile) throw new Error('profile is required');

            const nextVersion = expectedPalateProfileVersion === null
                ? 1
                : expectedPalateProfileVersion + 1;
            const timestamp = now();
            const profileSk = `${ PROFILE_SK_PREFIX }${ nextVersion }`;
            const profileItem = {
                pk: userPartitionKey(userId),
                sk: profileSk,
                entityType: PROFILE_ENTITY_TYPE,
                userId,
                palateProfileVersion: nextVersion,
                palateProfile: profile,
                createdAt: timestamp,
                updatedAt: timestamp,
            };

            try {
                await client.send(new TransactWriteCommand({
                    TransactItems: [
                        {
                            Put: {
                                TableName: userDataTableName,
                                Item: profileItem,
                                ConditionExpression: [
                                    'attribute_not_exists(pk)',
                                    'attribute_not_exists(sk)',
                                ].join(' AND '),
                            },
                        },
                        {
                            Update: createPointerUpdate({
                                tableName: userDataTableName,
                                userId,
                                expectedPalateProfileVersion,
                                nextVersion,
                                profileSk,
                                timestamp,
                            }),
                        },
                    ],
                }));
            } catch (error) {
                if (!isConditionalTransactionConflict(error)) {
                    throw error;
                }

                const currentPointer = await getCurrentPointer({
                    client,
                    tableName: userDataTableName,
                    userId,
                });

                throw createProfileVersionConflictError({
                    expectedPalateProfileVersion,
                    currentPalateProfileVersion:
                        currentPointer?.palateProfileVersion ?? null,
                });
            }

            return toPublicPalateProfile(profileItem);
        },
    };
};

export const isPalateProfileVersionConflict = error =>
    error?.name === 'PalateProfileVersionConflictError'
    || error?.isConditionalConflict === true;

const createPointerUpdate = ({
    tableName,
    userId,
    expectedPalateProfileVersion,
    nextVersion,
    profileSk,
    timestamp,
}) => {
    const expressionAttributeNames = {
        '#entityType': 'entityType',
        '#userId': 'userId',
        '#palateProfileVersion': 'palateProfileVersion',
        '#palateProfileSk': 'palateProfileSk',
        '#createdAt': 'createdAt',
        '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues = {
        ':pointerEntityType': POINTER_ENTITY_TYPE,
        ':userId': userId,
        ':nextPalateProfileVersion': nextVersion,
        ':palateProfileSk': profileSk,
        ':timestamp': timestamp,
    };

    if (expectedPalateProfileVersion !== null) {
        expressionAttributeValues[':expectedPalateProfileVersion'] =
            expectedPalateProfileVersion;
    }

    return {
        TableName: tableName,
        Key: {
            pk: userPartitionKey(userId),
            sk: CURRENT_POINTER_SK,
        },
        UpdateExpression: [
            'SET #entityType = :pointerEntityType',
            '#userId = :userId',
            '#palateProfileVersion = :nextPalateProfileVersion',
            '#palateProfileSk = :palateProfileSk',
            '#createdAt = if_not_exists(#createdAt, :timestamp)',
            '#updatedAt = :timestamp',
        ].join(', '),
        ConditionExpression: expectedPalateProfileVersion === null
            ? 'attribute_not_exists(pk) AND attribute_not_exists(sk)'
            : [
                '#entityType = :pointerEntityType',
                '#palateProfileVersion = :expectedPalateProfileVersion',
            ].join(' AND '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
    };
};

const getCurrentPointer = async ({
    client,
    tableName,
    userId,
}) => {
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: {
            pk: userPartitionKey(userId),
            sk: CURRENT_POINTER_SK,
        },
        ConsistentRead: true,
    }));

    return result.Item;
};

const toPublicPalateProfile = item => {
    if (!item.palateProfile || typeof item.palateProfile !== 'object') {
        throw new Error('Stored palate profile is missing its profile data');
    }
    if (
        !Number.isSafeInteger(item.palateProfileVersion)
        || item.palateProfileVersion < 1
    ) {
        throw new Error('Stored palate profile has an invalid version');
    }
    if (!item.createdAt || !item.updatedAt) {
        throw new Error('Stored palate profile is missing timestamps');
    }

    return {
        palateProfileVersion: item.palateProfileVersion,
        stylePreferences: item.palateProfile.stylePreferences,
        wineExamples: item.palateProfile.wineExamples,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
};

const isConditionalTransactionConflict = error => {
    if (error?.name === 'ConditionalCheckFailedException') {
        return true;
    }

    if (error?.name !== 'TransactionCanceledException') {
        return false;
    }

    const cancellationReasons =
        error.CancellationReasons
        ?? error.cancellationReasons
        ?? [];

    return cancellationReasons.some(
        reason => reason?.Code === 'ConditionalCheckFailed',
    );
};

const createProfileVersionConflictError = ({
    expectedPalateProfileVersion,
    currentPalateProfileVersion,
}) => {
    const error = new Error('The current palate profile version has changed');
    error.name = 'PalateProfileVersionConflictError';
    error.expectedPalateProfileVersion = expectedPalateProfileVersion;
    error.currentPalateProfileVersion = currentPalateProfileVersion;
    error.isConditionalConflict = true;
    return error;
};

const userPartitionKey = userId => `USER#${ userId }`;

import { describe, expect, it, vi } from 'vitest';
import {
    GetCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    createPalateProfileStore,
    isPalateProfileVersionConflict,
} from '@grapescrape/state/dynamodb/palateProfileStore';

const tableName = 'UserData';
const timestamp = '2026-07-23T10:30:00.000Z';
const profile = {
    stylePreferences: {
        body: {
            preferred: ['full'],
            avoided: ['light'],
        },
    },
    wineExamples: [],
};

const createStore = client => createPalateProfileStore({
    client,
    userDataTableName: tableName,
    now: () => timestamp,
});

describe('createPalateProfileStore', () => {
    it('requires the DynamoDB client and UserData table', () => {
        expect(() => createPalateProfileStore()).toThrow(
            'DynamoDB client is required',
        );
        expect(() => createPalateProfileStore({
            client: { send: vi.fn() },
            userDataTableName: '',
        })).toThrow('USER_DATA_TABLE_NAME is required');
    });

    it('reads the current immutable version through the assessor-compatible pointer', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Item: {
                        pk: 'USER#user-1',
                        sk: 'CURRENT_PALATE_PROFILE',
                        entityType: 'CurrentPalateProfilePointer',
                        userId: 'user-1',
                        palateProfileVersion: 4,
                        palateProfileSk: 'PALATE_PROFILE#4',
                        updatedAt: timestamp,
                    },
                })
                .mockResolvedValueOnce({
                    Item: {
                        pk: 'USER#user-1',
                        sk: 'PALATE_PROFILE#4',
                        entityType: 'PalateProfile',
                        userId: 'user-1',
                        palateProfileVersion: 4,
                        palateProfile: profile,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    },
                }),
        };

        const result = await createStore(client)
            .getCurrentPalateProfile('user-1');

        expect(result).toEqual({
            palateProfileVersion: 4,
            ...profile,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        expect(client.send.mock.calls.map(([command]) => command.input))
            .toEqual([
                {
                    TableName: tableName,
                    Key: {
                        pk: 'USER#user-1',
                        sk: 'CURRENT_PALATE_PROFILE',
                    },
                    ConsistentRead: true,
                },
                {
                    TableName: tableName,
                    Key: {
                        pk: 'USER#user-1',
                        sk: 'PALATE_PROFILE#4',
                    },
                    ConsistentRead: true,
                },
            ]);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
    });

    it('supports version-derived profile keys on established pointers', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Item: {
                        pk: 'USER#user-1',
                        sk: 'CURRENT_PALATE_PROFILE',
                        palateProfileVersion: 3,
                    },
                })
                .mockResolvedValueOnce({
                    Item: {
                        palateProfileVersion: 3,
                        palateProfile: profile,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    },
                }),
        };

        await createStore(client).getCurrentPalateProfile('user-1');

        expect(client.send.mock.calls[1][0].input.Key).toEqual({
            pk: 'USER#user-1',
            sk: 'PALATE_PROFILE#3',
        });
    });

    it('returns undefined when the user has no current pointer', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({}),
        };

        await expect(createStore(client).getCurrentPalateProfile('user-1'))
            .resolves.toBeUndefined();
        expect(client.send).toHaveBeenCalledOnce();
    });

    it('creates version one and the current pointer atomically for an initial profile', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({}),
        };

        const result = await createStore(client).putNextPalateProfile({
            userId: 'user-1',
            expectedPalateProfileVersion: null,
            profile,
        });

        expect(result).toEqual({
            palateProfileVersion: 1,
            ...profile,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        expect(client.send).toHaveBeenCalledOnce();
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(
            TransactWriteCommand,
        );
        expect(client.send.mock.calls[0][0].input).toEqual({
            TransactItems: [
                {
                    Put: {
                        TableName: tableName,
                        Item: {
                            pk: 'USER#user-1',
                            sk: 'PALATE_PROFILE#1',
                            entityType: 'PalateProfile',
                            userId: 'user-1',
                            palateProfileVersion: 1,
                            palateProfile: profile,
                            createdAt: timestamp,
                            updatedAt: timestamp,
                        },
                        ConditionExpression:
                            'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                    },
                },
                {
                    Update: {
                        TableName: tableName,
                        Key: {
                            pk: 'USER#user-1',
                            sk: 'CURRENT_PALATE_PROFILE',
                        },
                        UpdateExpression: [
                            'SET #entityType = :pointerEntityType',
                            '#userId = :userId',
                            '#palateProfileVersion = :nextPalateProfileVersion',
                            '#palateProfileSk = :palateProfileSk',
                            '#createdAt = if_not_exists(#createdAt, :timestamp)',
                            '#updatedAt = :timestamp',
                        ].join(', '),
                        ConditionExpression:
                            'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                        ExpressionAttributeNames: {
                            '#entityType': 'entityType',
                            '#userId': 'userId',
                            '#palateProfileVersion': 'palateProfileVersion',
                            '#palateProfileSk': 'palateProfileSk',
                            '#createdAt': 'createdAt',
                            '#updatedAt': 'updatedAt',
                        },
                        ExpressionAttributeValues: {
                            ':pointerEntityType': 'CurrentPalateProfilePointer',
                            ':userId': 'user-1',
                            ':nextPalateProfileVersion': 1,
                            ':palateProfileSk': 'PALATE_PROFILE#1',
                            ':timestamp': timestamp,
                        },
                    },
                },
            ],
        });
    });

    it('writes exactly one immutable next version and conditionally moves an existing pointer', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({}),
        };

        await createStore(client).putNextPalateProfile({
            userId: 'user-1',
            expectedPalateProfileVersion: 4,
            profile,
        });

        const transaction = client.send.mock.calls[0][0].input;
        expect(transaction.TransactItems).toHaveLength(2);
        expect(transaction.TransactItems[0].Put).toMatchObject({
            Item: {
                pk: 'USER#user-1',
                sk: 'PALATE_PROFILE#5',
                palateProfileVersion: 5,
                palateProfile: profile,
            },
            ConditionExpression:
                'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        });
        expect(transaction.TransactItems[1].Update).toMatchObject({
            Key: {
                pk: 'USER#user-1',
                sk: 'CURRENT_PALATE_PROFILE',
            },
            ConditionExpression: [
                '#entityType = :pointerEntityType',
                '#palateProfileVersion = :expectedPalateProfileVersion',
            ].join(' AND '),
            ExpressionAttributeValues: {
                ':pointerEntityType': 'CurrentPalateProfilePointer',
                ':userId': 'user-1',
                ':nextPalateProfileVersion': 5,
                ':palateProfileSk': 'PALATE_PROFILE#5',
                ':timestamp': timestamp,
                ':expectedPalateProfileVersion': 4,
            },
        });
    });

    it('reports a stale version with the safely reread current version and no partial commands', async () => {
        const transactionError = new Error('transaction cancelled');
        transactionError.name = 'TransactionCanceledException';
        transactionError.CancellationReasons = [
            { Code: 'None' },
            {
                Code: 'ConditionalCheckFailed',
                Message: 'raw cancellation detail',
            },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(transactionError)
                .mockResolvedValueOnce({
                    Item: {
                        pk: 'USER#user-1',
                        sk: 'CURRENT_PALATE_PROFILE',
                        palateProfileVersion: 5,
                    },
                }),
        };

        try {
            await createStore(client).putNextPalateProfile({
                userId: 'user-1',
                expectedPalateProfileVersion: 4,
                profile,
            });
            throw new Error('Expected putNextPalateProfile to reject');
        } catch (error) {
            expect(error).toMatchObject({
                name: 'PalateProfileVersionConflictError',
                expectedPalateProfileVersion: 4,
                currentPalateProfileVersion: 5,
                isConditionalConflict: true,
            });
            expect(error.message).not.toContain('raw cancellation detail');
            expect(isPalateProfileVersionConflict(error)).toBe(true);
        }

        expect(client.send).toHaveBeenCalledTimes(2);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(
            TransactWriteCommand,
        );
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
    });

    it('does not misclassify a non-conditional transaction failure', async () => {
        const dependencyError = new Error('capacity unavailable');
        dependencyError.name = 'ProvisionedThroughputExceededException';
        const client = {
            send: vi.fn().mockRejectedValue(dependencyError),
        };

        await expect(createStore(client).putNextPalateProfile({
            userId: 'user-1',
            expectedPalateProfileVersion: 4,
            profile,
        })).rejects.toBe(dependencyError);
        expect(client.send).toHaveBeenCalledOnce();
    });
});

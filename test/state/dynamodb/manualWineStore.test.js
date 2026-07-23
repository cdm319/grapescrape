import { describe, expect, it, vi } from 'vitest';
import {
    GetCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    createManualWineAssessmentReadStore,
    createManualWineStore,
    isManualWineAlreadyExists,
    isManualWineDeleted,
    isManualWineNotFound,
} from '@grapescrape/state/dynamodb/manualWineStore';

const timestamp = '2026-07-23T10:00:00.000Z';
const manualWineId = 'ffbd54ef-0c8e-49c7-a98e-e6703c08410e';
const sourceKey = `manual:${ manualWineId }`;
const activeItem = {
    pk: 'USER#user-1',
    sk: `MANUAL_WINE#${ manualWineId }`,
    entityType: 'ManualWine',
    userId: 'user-1',
    manualWineId,
    source: { type: 'manual', key: sourceKey },
    sourceKey,
    name: 'Cellar Example',
    vintage: 'NV',
    description: 'Rich red fruit.',
    status: 'active',
    isActive: true,
    deletedAt: null,
    sourceHash: 'source-hash',
    createdAt: timestamp,
    updatedAt: timestamp,
};
const publicRecord = {
    userId: 'user-1',
    id: manualWineId,
    sourceKey,
    source: { type: 'manual', key: sourceKey },
    name: 'Cellar Example',
    vintage: 'NV',
    description: 'Rich red fruit.',
    status: 'active',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceHash: 'source-hash',
};

const createStore = client => createManualWineStore({
    client,
    userDataTableName: 'UserData',
    now: () => timestamp,
});

describe('createManualWineStore', () => {
    it('creates the wine and retained identity reservation atomically', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({}),
        };

        const result = await createStore(client).createManualWine({
            userId: 'user-1',
            manualWineId,
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Rich red fruit.',
            identity: 'cellar example\u0000NV',
            sourceHash: 'source-hash',
        });

        expect(result).toEqual(publicRecord);
        expect(client.send).toHaveBeenCalledOnce();
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(
            TransactWriteCommand,
        );
        const transaction = client.send.mock.calls[0][0].input;
        expect(transaction.TransactItems).toHaveLength(2);
        expect(transaction.TransactItems[0].Put).toEqual({
            TableName: 'UserData',
            Item: activeItem,
            ConditionExpression:
                'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        });
        expect(transaction.TransactItems[1].Put).toMatchObject({
            TableName: 'UserData',
            Item: {
                pk: 'USER#user-1',
                sk: expect.stringMatching(
                    /^MANUAL_WINE_IDENTITY#[0-9a-f]{64}$/,
                ),
                entityType: 'ManualWineIdentity',
                userId: 'user-1',
                manualWineId,
                sourceKey,
                createdAt: timestamp,
            },
            ConditionExpression:
                'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        });
    });

    it('reconciles an existing identity reservation as a safe duplicate', async () => {
        const conflict = new Error('raw transaction cancellation');
        conflict.name = 'TransactionCanceledException';
        conflict.CancellationReasons = [
            { Code: 'None' },
            { Code: 'ConditionalCheckFailed', Message: 'raw duplicate key' },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({
                    Item: {
                        manualWineId:
                            '7b15f900-7b70-43a7-8cfa-c270e38e704e',
                    },
                }),
        };

        try {
            await createStore(client).createManualWine({
                userId: 'user-1',
                manualWineId,
                name: 'Cellar Example',
                vintage: 'NV',
                description: '',
                identity: 'cellar example\u0000NV',
                sourceHash: 'source-hash',
            });
            throw new Error('Expected duplicate create to reject');
        } catch (error) {
            expect(isManualWineAlreadyExists(error)).toBe(true);
            expect(error.message).not.toContain('raw duplicate');
        }
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[1][0].input.ConsistentRead).toBe(true);
    });

    it('reconciles a concurrent transaction winner as a safe duplicate', async () => {
        const conflict = new Error('transaction conflict');
        conflict.name = 'TransactionCanceledException';
        conflict.CancellationReasons = [
            { Code: 'TransactionConflict' },
            { Code: 'None' },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({
                    Item: {
                        manualWineId:
                            '7b15f900-7b70-43a7-8cfa-c270e38e704e',
                    },
                }),
        };

        await expect(createStore(client).createManualWine({
            userId: 'user-1',
            manualWineId,
            name: 'Cellar Example',
            vintage: 'NV',
            description: '',
            identity: 'cellar example\u0000NV',
            sourceHash: 'source-hash',
        })).rejects.toSatisfy(isManualWineAlreadyExists);
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('retries an initial transaction collision when no winner is visible', async () => {
        const conflict = new Error('transaction conflict');
        conflict.name = 'TransactionCanceledException';
        conflict.CancellationReasons = [
            { Code: 'TransactionConflict' },
            { Code: 'None' },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({}),
        };

        await expect(createStore(client).createManualWine({
            userId: 'user-1',
            manualWineId,
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Rich red fruit.',
            identity: 'cellar example\u0000NV',
            sourceHash: 'source-hash',
        })).resolves.toEqual(publicRecord);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(
            TransactWriteCommand,
        );
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[2][0]).toBeInstanceOf(
            TransactWriteCommand,
        );
    });

    it('bounds retries when transaction conflicts do not reveal a winner', async () => {
        const conflict = new Error('transaction conflict');
        conflict.name = 'TransactionCanceledException';
        conflict.CancellationReasons = [
            { Code: 'TransactionConflict' },
            { Code: 'None' },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({}),
        };

        try {
            await createStore(client).createManualWine({
                userId: 'user-1',
                manualWineId,
                name: 'Cellar Example',
                vintage: 'NV',
                description: '',
                identity: 'cellar example\u0000NV',
                sourceHash: 'source-hash',
            });
            throw new Error('Expected transaction conflicts to reject');
        } catch (error) {
            expect(error).toBe(conflict);
            expect(isManualWineAlreadyExists(error)).toBe(false);
        }
        expect(client.send).toHaveBeenCalledTimes(6);
        expect(client.send.mock.calls.filter(
            ([command]) => command instanceof TransactWriteCommand,
        )).toHaveLength(3);
    });

    it('does not report an unrelated conditional conflict as a duplicate', async () => {
        const conflict = new Error('conditional conflict');
        conflict.name = 'TransactionCanceledException';
        conflict.CancellationReasons = [
            { Code: 'ConditionalCheckFailed' },
            { Code: 'None' },
        ];
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({}),
        };

        try {
            await createStore(client).createManualWine({
                userId: 'user-1',
                manualWineId,
                name: 'Cellar Example',
                vintage: 'NV',
                description: '',
                identity: 'cellar example\u0000NV',
                sourceHash: 'source-hash',
            });
            throw new Error('Expected conditional conflict to reject');
        } catch (error) {
            expect(error).toBe(conflict);
            expect(isManualWineAlreadyExists(error)).toBe(false);
        }
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('queries only the user manual-wine key range and returns active records', async () => {
        const deletedItem = {
            ...activeItem,
            manualWineId: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
            sourceKey: 'manual:7b15f900-7b70-43a7-8cfa-c270e38e704e',
            status: 'deleted',
            isActive: false,
            deletedAt: timestamp,
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [deletedItem],
                    LastEvaluatedKey: {
                        pk: 'USER#user-1',
                        sk: deletedItem.sk,
                    },
                })
                .mockResolvedValueOnce({
                    Items: [activeItem],
                }),
        };

        const result = await createStore(client)
            .listActiveManualWines('user-1');

        expect(result).toEqual([publicRecord]);
        expect(client.send).toHaveBeenCalledTimes(2);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'UserData',
            KeyConditionExpression:
                '#pk = :pk AND begins_with(#sk, :manualWinePrefix)',
            ExpressionAttributeNames: {
                '#pk': 'pk',
                '#sk': 'sk',
            },
            ExpressionAttributeValues: {
                ':pk': 'USER#user-1',
                ':manualWinePrefix': 'MANUAL_WINE#',
            },
            ConsistentRead: true,
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
            pk: 'USER#user-1',
            sk: deletedItem.sk,
        });
    });

    it('reads owner-scoped active or deleted records by ID and source key', async () => {
        const deletedItem = {
            ...activeItem,
            status: 'deleted',
            isActive: false,
            deletedAt: timestamp,
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: activeItem })
                .mockResolvedValueOnce({ Item: deletedItem }),
        };
        const store = createStore(client);

        await expect(store.getManualWineById({
            userId: 'user-1',
            manualWineId,
        })).resolves.toEqual(publicRecord);
        await expect(store.getManualWineBySourceKey({
            userId: 'user-1',
            sourceKey,
        })).resolves.toEqual({
            ...publicRecord,
            status: 'deleted',
            isActive: false,
            deletedAt: timestamp,
        });

        expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[0][0].input.Key).toEqual({
            pk: 'USER#user-1',
            sk: `MANUAL_WINE#${ manualWineId }`,
        });
        await expect(store.getManualWineBySourceKey({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
        })).resolves.toBeUndefined();
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('reads the current palate profile pointer version', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Item: { palateProfileVersion: 4 },
                })
                .mockResolvedValueOnce({}),
        };
        const store = createStore(client);

        await expect(store.getCurrentPalateProfileVersion('user-1'))
            .resolves.toBe(4);
        await expect(store.getCurrentPalateProfileVersion('user-2'))
            .resolves.toBeNull();
    });

    it('updates only description, source hash, and update timestamp for an active wine', async () => {
        const updated = {
            ...activeItem,
            description: 'Updated.',
            sourceHash: 'updated-hash',
            updatedAt: '2026-07-23T11:00:00.000Z',
        };
        const client = {
            send: vi.fn().mockResolvedValue({ Attributes: updated }),
        };
        const store = createManualWineStore({
            client,
            userDataTableName: 'UserData',
            now: () => '2026-07-23T11:00:00.000Z',
        });

        const result = await store.updateManualWineDescription({
            userId: 'user-1',
            manualWineId,
            description: 'Updated.',
            sourceHash: 'updated-hash',
        });

        expect(result).toEqual({
            ...publicRecord,
            description: 'Updated.',
            sourceHash: 'updated-hash',
            updatedAt: '2026-07-23T11:00:00.000Z',
        });
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
        expect(client.send.mock.calls[0][0].input).toMatchObject({
            Key: {
                pk: 'USER#user-1',
                sk: `MANUAL_WINE#${ manualWineId }`,
            },
            ConditionExpression:
                '#entityType = :entityType AND #status = :active',
            ExpressionAttributeValues: {
                ':entityType': 'ManualWine',
                ':active': 'active',
                ':description': 'Updated.',
                ':sourceHash': 'updated-hash',
                ':updatedAt': '2026-07-23T11:00:00.000Z',
            },
        });
    });

    it.each([
        [undefined, isManualWineNotFound],
        [{
            ...activeItem,
            status: 'deleted',
            isActive: false,
            deletedAt: timestamp,
        }, isManualWineDeleted],
    ])('distinguishes missing and deleted records after a patch conflict', async (
        item,
        predicate,
    ) => {
        const conflict = new Error('condition failed');
        conflict.name = 'ConditionalCheckFailedException';
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce(item ? { Item: item } : {}),
        };

        await expect(createStore(client).updateManualWineDescription({
            userId: 'user-1',
            manualWineId,
            description: 'Updated.',
            sourceHash: 'updated-hash',
        })).rejects.toSatisfy(predicate);
    });

    it('soft-deletes once and preserves the original deletion time on retries', async () => {
        const deletedItem = {
            ...activeItem,
            status: 'deleted',
            isActive: false,
            deletedAt: '2026-07-23T11:00:00.000Z',
            updatedAt: '2026-07-23T11:00:00.000Z',
        };
        const conflict = new Error('condition failed');
        conflict.name = 'ConditionalCheckFailedException';
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Attributes: deletedItem })
                .mockRejectedValueOnce(conflict)
                .mockResolvedValueOnce({ Item: deletedItem }),
        };
        const store = createManualWineStore({
            client,
            userDataTableName: 'UserData',
            now: () => '2026-07-23T11:00:00.000Z',
        });

        const first = await store.softDeleteManualWine({
            userId: 'user-1',
            manualWineId,
        });
        const second = await store.softDeleteManualWine({
            userId: 'user-1',
            manualWineId,
        });

        expect(first.deletedAt).toBe('2026-07-23T11:00:00.000Z');
        expect(second.deletedAt).toBe(first.deletedAt);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
        expect(client.send.mock.calls[2][0]).toBeInstanceOf(GetCommand);
    });
});

describe('createManualWineAssessmentReadStore', () => {
    it('returns the highest completed assessment version across query pages', async () => {
        const versionTwo = {
            status: 'completed',
            assessmentVersion: 2,
            completedAt: '2026-07-23T11:00:00.000Z',
        };
        const versionFive = {
            status: 'completed',
            assessmentVersion: 5,
            completedAt: '2026-07-23T10:00:00.000Z',
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [
                        versionTwo,
                        { status: 'pending', assessmentVersion: 9 },
                    ],
                    LastEvaluatedKey: { pk: 'next' },
                })
                .mockResolvedValueOnce({
                    Items: [versionFive],
                }),
        };
        const store = createManualWineAssessmentReadStore({
            client,
            assessmentsTableName: 'Assessments',
        });

        await expect(store.getHighestCompletedAssessment({
            userId: 'user-1',
            sourceKey,
        })).resolves.toBe(versionFive);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI2',
            KeyConditionExpression: '#gsi2pk = :gsi2pk',
            ExpressionAttributeNames: {
                '#gsi2pk': 'gsi2pk',
            },
            ExpressionAttributeValues: {
                ':gsi2pk': `USER#user-1#SOURCE#${ sourceKey }`,
            },
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey)
            .toEqual({ pk: 'next' });
    });
});

import { describe, expect, it, vi } from 'vitest';
import {
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    createAssessmentVersionStore,
} from '@grapescrape/state/dynamodb/assessmentVersionStore';

const tableNames = {
    assessmentsTableName: 'Assessments',
    userDataTableName: 'UserData',
};

describe('createAssessmentVersionStore', () => {
    it('requires a DynamoDB client and both existing table names', () => {
        expect(() => createAssessmentVersionStore()).toThrow('DynamoDB client is required');
        expect(() => createAssessmentVersionStore({
            client: { send: vi.fn() },
            assessmentsTableName: '',
            userDataTableName: 'UserData',
        })).toThrow('ASSESSMENTS_TABLE_NAME is required');
        expect(() => createAssessmentVersionStore({
            client: { send: vi.fn() },
            assessmentsTableName: 'Assessments',
            userDataTableName: '',
        })).toThrow('USER_DATA_TABLE_NAME is required');
    });

    it('requires user and source scope for every allocation', async () => {
        const store = createAssessmentVersionStore({
            client: { send: vi.fn() },
            ...tableNames,
        });

        await expect(store.allocateNextAssessmentVersion())
            .rejects.toThrow('userId is required');
        await expect(store.allocateNextAssessmentVersion({
            userId: 'user-1',
        })).rejects.toThrow('sourceKey is required');
    });

    it('validates bulk allocation scope, uniqueness and the 25-source maximum', async () => {
        const client = { send: vi.fn() };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        await expect(store.allocateNextAssessmentVersions())
            .rejects.toThrow('userId is required');
        await expect(store.allocateNextAssessmentVersions({ userId: 'user-1' }))
            .rejects.toThrow('sourceKeys is required');
        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: [],
        })).rejects.toThrow('sourceKeys must contain between 1 and 25 items');
        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1', 'manual:wine-1'],
        })).rejects.toThrow('sourceKeys must be unique');
        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: Array.from({ length: 26 }, (_, index) => `manual:wine-${ index }`),
        })).rejects.toThrow('sourceKeys must contain between 1 and 25 items');
        expect(client.send).not.toHaveBeenCalled();
    });

    it('increments existing counters together in one transaction and preserves input order', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: counter('manual:wine-2', 4) })
                .mockResolvedValueOnce({ Item: counter('retailer:tws:wine-1', 7) })
                .mockResolvedValueOnce({}),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
            now: () => '2026-08-03T12:00:00.000Z',
        });

        const result = await store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-2', 'retailer:tws:wine-1'],
        });

        expect(result).toEqual([
            { sourceKey: 'manual:wine-2', assessmentVersion: 5 },
            { sourceKey: 'retailer:tws:wine-1', assessmentVersion: 8 },
        ]);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[2][0]).toBeInstanceOf(TransactWriteCommand);
        expect(client.send.mock.calls[2][0].input.TransactItems).toEqual([
            expect.objectContaining({
                Update: expect.objectContaining({
                    Key: {
                        pk: 'USER#user-1',
                        sk: 'ASSESSMENT_VERSION#manual%3Awine-2',
                    },
                    ExpressionAttributeValues: expect.objectContaining({
                        ':currentVersion': 4,
                        ':nextVersion': 5,
                    }),
                }),
            }),
            expect.objectContaining({
                Update: expect.objectContaining({
                    Key: {
                        pk: 'USER#user-1',
                        sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine-1',
                    },
                    ExpressionAttributeValues: expect.objectContaining({
                        ':currentVersion': 7,
                        ':nextVersion': 8,
                    }),
                }),
            }),
        ]);
    });

    it('bootstraps missing counters from paginated history in the same mixed transaction', async () => {
        const lastEvaluatedKey = { pk: 'page-1', sk: 'page-1' };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: counter('retailer:tws:wine-1', 2) })
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({
                    Items: [{ assessmentVersion: 3 }],
                    LastEvaluatedKey: lastEvaluatedKey,
                })
                .mockResolvedValueOnce({ Items: [{ assessmentVersion: 5 }] })
                .mockResolvedValueOnce({}),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
            now: () => '2026-08-03T12:00:00.000Z',
        });

        const result = await store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['retailer:tws:wine-1', 'manual:wine-2'],
        });

        expect(result).toEqual([
            { sourceKey: 'retailer:tws:wine-1', assessmentVersion: 3 },
            { sourceKey: 'manual:wine-2', assessmentVersion: 6 },
        ]);
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof QueryCommand)).toHaveLength(2);
        expect(client.send.mock.calls[3][0].input.ExclusiveStartKey).toEqual(lastEvaluatedKey);
        const transaction = client.send.mock.calls[4][0];
        expect(transaction).toBeInstanceOf(TransactWriteCommand);
        expect(transaction.input.TransactItems[0]).toHaveProperty('Update');
        expect(transaction.input.TransactItems[1]).toEqual({
            Put: {
                TableName: 'UserData',
                Item: {
                    pk: 'USER#user-1',
                    sk: 'ASSESSMENT_VERSION#manual%3Awine-2',
                    entityType: 'AssessmentVersionCounter',
                    userId: 'user-1',
                    sourceKey: 'manual:wine-2',
                    latestAssessmentVersion: 6,
                    createdAt: '2026-08-03T12:00:00.000Z',
                    updatedAt: '2026-08-03T12:00:00.000Z',
                },
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
            },
        });
    });

    it('re-reads counters and retries the complete transaction after a conflict', async () => {
        const transactionConflict = new Error('transaction conflict');
        transactionConflict.name = 'TransactionConflictException';
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: counter('manual:wine-1', 2) })
                .mockRejectedValueOnce(transactionConflict)
                .mockResolvedValueOnce({ Item: counter('manual:wine-1', 3) })
                .mockResolvedValueOnce({}),
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        const result = await store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
        });

        expect(result).toEqual([
            { sourceKey: 'manual:wine-1', assessmentVersion: 4 },
        ]);
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof GetCommand)).toHaveLength(2);
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof TransactWriteCommand)).toHaveLength(2);
    });

    it('bounds bulk transaction conflicts and reports the complete source scope', async () => {
        const transactionConflict = new Error('transaction conflict');
        transactionConflict.name = 'TransactionCanceledException';
        transactionConflict.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
        const client = {
            send: vi.fn().mockImplementation(command =>
                command instanceof GetCommand
                    ? Promise.resolve({ Item: counter('manual:wine-1', 2) })
                    : Promise.reject(transactionConflict)
            ),
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
        })).rejects.toMatchObject({
            name: 'AssessmentVersionAllocationConflictError',
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
            attempts: 3,
            isConditionalConflict: true,
        });
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof TransactWriteCommand)).toHaveLength(3);
    });

    it('atomically allocates concurrent requests with overlapping source sets', async () => {
        const counters = new Map([
            ['retailer:tws:wine-1', 1],
            ['retailer:tws:wine-2', 1],
            ['retailer:tws:wine-3', 1],
        ]);
        const client = {
            async send(command) {
                if (command instanceof GetCommand) {
                    const sourceKey = decodeURIComponent(
                        command.input.Key.sk.slice('ASSESSMENT_VERSION#'.length)
                    );
                    const version = counters.get(sourceKey);
                    await Promise.resolve();
                    return version === undefined
                        ? {}
                        : { Item: counter(sourceKey, version) };
                }

                if (command instanceof TransactWriteCommand) {
                    const updates = command.input.TransactItems.map(({ Update }) => ({
                        sourceKey: decodeURIComponent(
                            Update.Key.sk.slice('ASSESSMENT_VERSION#'.length)
                        ),
                        currentVersion: Update.ExpressionAttributeValues[':currentVersion'],
                        nextVersion: Update.ExpressionAttributeValues[':nextVersion'],
                    }));
                    const conflicted = updates.some(update =>
                        counters.get(update.sourceKey) !== update.currentVersion
                    );

                    if (conflicted) {
                        const error = new Error('transaction conflict');
                        error.name = 'TransactionCanceledException';
                        error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
                        throw error;
                    }

                    for (const update of updates) {
                        counters.set(update.sourceKey, update.nextVersion);
                    }
                    return {};
                }

                throw new Error('Unexpected command');
            },
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        const [first, second] = await Promise.all([
            store.allocateNextAssessmentVersions({
                userId: 'user-1',
                sourceKeys: ['retailer:tws:wine-1', 'retailer:tws:wine-2'],
            }),
            store.allocateNextAssessmentVersions({
                userId: 'user-1',
                sourceKeys: ['retailer:tws:wine-2', 'retailer:tws:wine-3'],
            }),
        ]);

        expect(first).toEqual([
            { sourceKey: 'retailer:tws:wine-1', assessmentVersion: 2 },
            { sourceKey: 'retailer:tws:wine-2', assessmentVersion: 2 },
        ]);
        expect(second).toEqual([
            { sourceKey: 'retailer:tws:wine-2', assessmentVersion: 3 },
            { sourceKey: 'retailer:tws:wine-3', assessmentVersion: 2 },
        ]);
        expect(counters).toEqual(new Map([
            ['retailer:tws:wine-1', 2],
            ['retailer:tws:wine-2', 3],
            ['retailer:tws:wine-3', 2],
        ]));
    });

    it('rejects an existing counter that cannot be safely incremented', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Item: counter('manual:wine-1', Number.MAX_SAFE_INTEGER),
            }),
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
        })).rejects.toThrow('Assessment version counter is invalid');
        expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('rejects historical bootstrap when no safe next version exists', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({
                    Items: [{ assessmentVersion: Number.MAX_SAFE_INTEGER }],
                }),
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
        })).rejects.toThrow('Historical assessment has an invalid assessmentVersion');
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('does not retry unexpected bulk DynamoDB failures', async () => {
        const serviceError = new Error('service unavailable');
        serviceError.name = 'ServiceUnavailable';
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: counter('manual:wine-1', 2) })
                .mockRejectedValueOnce(serviceError),
        };
        const store = createAssessmentVersionStore({ client, ...tableNames });

        await expect(store.allocateNextAssessmentVersions({
            userId: 'user-1',
            sourceKeys: ['manual:wine-1'],
        })).rejects.toBe(serviceError);
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    it('conditionally stores and returns version 1 when the source has no history', async () => {
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conditionalConflict())
                .mockResolvedValueOnce({ Items: [] })
                .mockResolvedValueOnce({}),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        const result = await store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
        });

        expect(result).toBe(1);

        expect(client.send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'UserData',
            Key: {
                pk: 'USER#user-1',
                sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine-1',
            },
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
                ':entityType': 'AssessmentVersionCounter',
                ':increment': 1,
                ':updatedAt': expect.any(String),
            },
            ReturnValues: 'UPDATED_NEW',
        });

        expect(client.send.mock.calls[1][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[1][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI2',
            KeyConditionExpression: '#gsi2pk = :gsi2pk',
            ExpressionAttributeNames: {
                '#gsi2pk': 'gsi2pk',
                '#assessmentVersion': 'assessmentVersion',
            },
            ExpressionAttributeValues: {
                ':gsi2pk': 'USER#user-1#SOURCE#retailer:tws:wine-1',
            },
            ProjectionExpression: '#assessmentVersion',
        });

        expect(client.send.mock.calls[2][0]).toBeInstanceOf(PutCommand);
        const putInput = client.send.mock.calls[2][0].input;
        expect(putInput).toEqual({
            TableName: 'UserData',
            Item: {
                pk: 'USER#user-1',
                sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine-1',
                entityType: 'AssessmentVersionCounter',
                userId: 'user-1',
                sourceKey: 'retailer:tws:wine-1',
                latestAssessmentVersion: 1,
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            },
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        });
        expect(putInput.Item.updatedAt).toBe(putInput.Item.createdAt);
    });

    it('paginates source history and stores historicalMaximum plus one', async () => {
        const lastEvaluatedKey = {
            pk: 'USER#user-1',
            sk: 'ASSESSMENT#key-2',
            gsi2pk: 'USER#user-1#SOURCE#manual:wine-1',
            gsi2sk: 'CREATED#2026-01-02T00:00:00.000Z#ASSESSMENT#key-2',
        };
        const client = {
            send: vi.fn()
                .mockRejectedValueOnce(conditionalConflict())
                .mockResolvedValueOnce({
                    Items: [
                        { assessmentVersion: 2 },
                        {},
                    ],
                    LastEvaluatedKey: lastEvaluatedKey,
                })
                .mockResolvedValueOnce({
                    Items: [
                        { assessmentVersion: 5 },
                        { assessmentVersion: 3 },
                    ],
                })
                .mockResolvedValueOnce({}),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        const result = await store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'manual:wine-1',
        });

        expect(result).toBe(6);
        expect(client.send.mock.calls[2][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[2][0].input).toMatchObject({
            ExclusiveStartKey: lastEvaluatedKey,
        });
        expect(client.send.mock.calls[3][0].input.Item).toMatchObject({
            entityType: 'AssessmentVersionCounter',
            latestAssessmentVersion: 6,
        });
    });

    it('atomically increments and returns an existing counter without querying history', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Attributes: {
                    latestAssessmentVersion: 8,
                    updatedAt: '2026-01-02T03:04:05.000Z',
                },
            }),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        const result = await store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
        });

        expect(result).toBe(8);
        expect(client.send).toHaveBeenCalledTimes(1);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(UpdateCommand);
    });

    it('uses stable collision-free source encoding and scopes counters by user', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Attributes: { latestAssessmentVersion: 2 },
            }),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        await store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine/1',
        });
        await store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine%2F1',
        });
        await store.allocateNextAssessmentVersion({
            userId: 'user-2',
            sourceKey: 'retailer:tws:wine/1',
        });

        expect(client.send.mock.calls.map(([command]) => command.input.Key)).toEqual([
            {
                pk: 'USER#user-1',
                sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine%2F1',
            },
            {
                pk: 'USER#user-1',
                sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine%252F1',
            },
            {
                pk: 'USER#user-2',
                sk: 'ASSESSMENT_VERSION#retailer%3Atws%3Awine%2F1',
            },
        ]);
    });

    it('returns unique monotonic versions to concurrent callers for one source', async () => {
        const counters = new Map();
        const client = {
            async send(command) {
                await Promise.resolve();

                if (command instanceof UpdateCommand) {
                    const key = JSON.stringify(command.input.Key);
                    const currentVersion = counters.get(key);

                    if (currentVersion === undefined) {
                        throw conditionalConflict();
                    }

                    const nextVersion = currentVersion + 1;
                    counters.set(key, nextVersion);
                    return {
                        Attributes: {
                            latestAssessmentVersion: nextVersion,
                        },
                    };
                }

                if (command instanceof QueryCommand) {
                    return { Items: [] };
                }

                if (command instanceof PutCommand) {
                    const key = JSON.stringify({
                        pk: command.input.Item.pk,
                        sk: command.input.Item.sk,
                    });

                    if (counters.has(key)) {
                        throw conditionalConflict();
                    }

                    counters.set(key, command.input.Item.latestAssessmentVersion);
                    return {};
                }

                throw new Error('Unexpected command');
            },
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        const versions = await Promise.all(
            Array.from({ length: 10 }, () => store.allocateNextAssessmentVersion({
                userId: 'user-1',
                sourceKey: 'retailer:tws:wine-1',
            }))
        );

        expect(versions.toSorted((left, right) => left - right))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('bounds repeated bootstrap conflicts and surfaces stable allocation metadata', async () => {
        const client = {
            send: vi.fn().mockImplementation(command => {
                if (command instanceof QueryCommand) {
                    return Promise.resolve({ Items: [] });
                }

                return Promise.reject(conditionalConflict());
            }),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        await expect(store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
        })).rejects.toMatchObject({
            name: 'AssessmentVersionAllocationConflictError',
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
            attempts: 3,
            isConditionalConflict: true,
        });

        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof UpdateCommand)).toHaveLength(3);
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof QueryCommand)).toHaveLength(3);
        expect(client.send.mock.calls.filter(([command]) =>
            command instanceof PutCommand)).toHaveLength(3);
    });

    it('does not retry unexpected DynamoDB failures', async () => {
        const serviceError = new Error('service unavailable');
        serviceError.name = 'ServiceUnavailable';
        const client = {
            send: vi.fn().mockRejectedValue(serviceError),
        };
        const store = createAssessmentVersionStore({
            client,
            ...tableNames,
        });

        await expect(store.allocateNextAssessmentVersion({
            userId: 'user-1',
            sourceKey: 'retailer:tws:wine-1',
        })).rejects.toBe(serviceError);
        expect(client.send).toHaveBeenCalledTimes(1);
    });
});

const conditionalConflict = () => {
    const error = new Error('conditional conflict');
    error.name = 'ConditionalCheckFailedException';
    return error;
};

const counter = (sourceKey, latestAssessmentVersion) => ({
    entityType: 'AssessmentVersionCounter',
    userId: 'user-1',
    sourceKey,
    latestAssessmentVersion,
});

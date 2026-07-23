import { describe, expect, it, vi } from 'vitest';
import {
    PutCommand,
    QueryCommand,
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

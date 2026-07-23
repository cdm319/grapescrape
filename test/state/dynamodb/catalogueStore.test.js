import { describe, expect, it, vi } from 'vitest';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createCatalogueStore } from '@grapescrape/state/dynamodb/catalogueStore';

const createStore = client => createCatalogueStore({
    client,
    wineStockTableName: 'WineStock',
    assessmentsTableName: 'Assessments',
    userDataTableName: 'UserData',
});

describe('createCatalogueStore', () => {
    it('requires a DynamoDB client and all three table names', () => {
        expect(() => createCatalogueStore()).toThrow('DynamoDB client is required');
        expect(() => createCatalogueStore({
            client: { send: vi.fn() },
            wineStockTableName: '',
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        })).toThrow('WINE_STOCK_TABLE_NAME is required');
        expect(() => createCatalogueStore({
            client: { send: vi.fn() },
            wineStockTableName: 'WineStock',
            assessmentsTableName: '',
            userDataTableName: 'UserData',
        })).toThrow('ASSESSMENTS_TABLE_NAME is required');
        expect(() => createCatalogueStore({
            client: { send: vi.fn() },
            wineStockTableName: 'WineStock',
            assessmentsTableName: 'Assessments',
            userDataTableName: '',
        })).toThrow('USER_DATA_TABLE_NAME is required');
    });

    it('queries the current-listings index and omits non-current rows defensively', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [
                        { sourceKey: 'retailer:tws:wine-1', isCurrent: true },
                        { sourceKey: 'retailer:tws:removed', isCurrent: false },
                    ],
                    LastEvaluatedKey: { pk: 'next' },
                })
                .mockResolvedValueOnce({
                    Items: [{ sourceKey: 'retailer:tws:wine-2', isCurrent: true }],
                }),
        };

        const result = await createStore(client).listCurrentWines({
            retailerIds: ['tws'],
        });

        expect(result.map(item => item.sourceKey)).toEqual([
            'retailer:tws:wine-1',
            'retailer:tws:wine-2',
        ]);
        expect(client.send.mock.calls.map(call => call[0])).toEqual([
            expect.any(QueryCommand),
            expect.any(QueryCommand),
        ]);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            IndexName: 'GSI1',
            KeyConditionExpression: '#gsi1pk = :gsi1pk',
            ExpressionAttributeNames: {
                '#gsi1pk': 'gsi1pk',
            },
            ExpressionAttributeValues: {
                ':gsi1pk': 'RETAILER#tws#CURRENT',
            },
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'next' });
    });

    it('gets a current retailer wine by its table key', async () => {
        const wine = {
            sourceKey: 'retailer:tws:wine-1',
            isCurrent: true,
        };
        const client = { send: vi.fn().mockResolvedValue({ Item: wine }) };

        const result = await createStore(client).getCurrentWine({
            retailerId: 'tws',
            wineId: 'wine-1',
        });

        expect(result).toBe(wine);
        expect(client.send).toHaveBeenCalledWith(expect.any(GetCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            Key: {
                pk: 'RETAILER#tws',
                sk: 'LISTING#wine-1',
            },
        });
    });

    it.each([
        undefined,
        { sourceKey: 'retailer:tws:wine-1', isCurrent: false },
    ])('does not return a missing or non-current retailer wine', async item => {
        const client = { send: vi.fn().mockResolvedValue({ Item: item }) };

        await expect(createStore(client).getCurrentWine({
            retailerId: 'tws',
            wineId: 'wine-1',
        })).resolves.toBeUndefined();
    });

    it('selects the completed assessment with the highest assessmentVersion across pages', async () => {
        const versionTwo = {
            assessmentInputKey: 'key-2',
            assessmentVersion: 2,
            completedAt: '2026-07-23T10:00:00.000Z',
        };
        const versionFour = {
            assessmentInputKey: 'key-4',
            assessmentVersion: 4,
            completedAt: '2026-07-22T10:00:00.000Z',
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [versionTwo],
                    LastEvaluatedKey: { pk: 'next' },
                })
                .mockResolvedValueOnce({
                    Items: [versionFour],
                }),
        };

        const result = await createStore(client).getLatestCompletedAssessment({
            userId: 'user-subject',
            sourceKey: 'retailer:tws:wine-1',
        });

        expect(result).toBe(versionFour);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI2',
            KeyConditionExpression: '#gsi2pk = :gsi2pk',
            FilterExpression: '#status = :completed',
            ExpressionAttributeNames: {
                '#gsi2pk': 'gsi2pk',
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':gsi2pk': 'USER#user-subject#SOURCE#retailer:tws:wine-1',
                ':completed': 'completed',
            },
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'next' });
    });

    it('gets the latest completed assessment for each requested source from the user index', async () => {
        const wineOneVersionOne = {
            sourceKey: 'retailer:tws:wine-1',
            assessmentInputKey: 'wine-1-version-1',
            assessmentVersion: 1,
        };
        const wineOneVersionThree = {
            sourceKey: 'retailer:tws:wine-1',
            assessmentInputKey: 'wine-1-version-3',
            assessmentVersion: 3,
        };
        const wineTwoVersionTwo = {
            sourceKey: 'retailer:tws:wine-2',
            assessmentInputKey: 'wine-2-version-2',
            assessmentVersion: 2,
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [
                        wineOneVersionOne,
                        {
                            sourceKey: 'retailer:tws:not-requested',
                            assessmentVersion: 8,
                        },
                    ],
                    LastEvaluatedKey: { pk: 'next' },
                })
                .mockResolvedValueOnce({
                    Items: [wineOneVersionThree, wineTwoVersionTwo],
                }),
        };

        const result = await createStore(client).getLatestCompletedAssessments({
            userId: 'user-subject',
            sourceKeys: [
                'retailer:tws:wine-1',
                'retailer:tws:wine-2',
            ],
        });

        expect([...result.entries()]).toEqual([
            ['retailer:tws:wine-1', wineOneVersionThree],
            ['retailer:tws:wine-2', wineTwoVersionTwo],
        ]);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI1',
            KeyConditionExpression: '#gsi1pk = :gsi1pk',
            FilterExpression: '#status = :completed',
            ExpressionAttributeNames: {
                '#gsi1pk': 'gsi1pk',
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':gsi1pk': 'USER#user-subject#ASSESSMENTS',
                ':completed': 'completed',
            },
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'next' });
    });

    it('uses completion time and assessment key as deterministic same-version tie-breakers', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Items: [
                    {
                        assessmentInputKey: 'key-a',
                        assessmentVersion: 3,
                        completedAt: '2026-07-23T10:00:00.000Z',
                    },
                    {
                        assessmentInputKey: 'key-b',
                        assessmentVersion: 3,
                        completedAt: '2026-07-23T10:00:00.000Z',
                    },
                ],
            }),
        };

        const result = await createStore(client).getLatestCompletedAssessment({
            userId: 'user-subject',
            sourceKey: 'retailer:tws:wine-1',
        });

        expect(result.assessmentInputKey).toBe('key-b');
    });

    it('returns null when the authenticated user has no current palate profile pointer', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };

        const result = await createStore(client)
            .getCurrentPalateProfileVersion('user-subject');

        expect(result).toBeNull();
        expect(client.send).toHaveBeenCalledWith(expect.any(GetCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'UserData',
            Key: {
                pk: 'USER#user-subject',
                sk: 'CURRENT_PALATE_PROFILE',
            },
            ProjectionExpression: '#palateProfileVersion',
            ExpressionAttributeNames: {
                '#palateProfileVersion': 'palateProfileVersion',
            },
        });
    });
});

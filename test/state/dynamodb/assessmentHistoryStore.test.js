import { describe, expect, it, vi } from 'vitest';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
    createAssessmentHistoryStore,
} from '@grapescrape/state/dynamodb/assessmentHistoryStore';

const tableNames = {
    assessmentsTableName: 'Assessments',
    userDataTableName: 'UserData',
    wineStockTableName: 'WineStock',
};

describe('createAssessmentHistoryStore', () => {
    it('requires the DynamoDB client and all read table names', () => {
        expect(() => createAssessmentHistoryStore()).toThrow('DynamoDB client is required');
        expect(() => createAssessmentHistoryStore({
            client: { send: vi.fn() },
            ...tableNames,
            assessmentsTableName: '',
        })).toThrow('ASSESSMENTS_TABLE_NAME is required');
        expect(() => createAssessmentHistoryStore({
            client: { send: vi.fn() },
            ...tableNames,
            userDataTableName: '',
        })).toThrow('USER_DATA_TABLE_NAME is required');
        expect(() => createAssessmentHistoryStore({
            client: { send: vi.fn() },
            ...tableNames,
            wineStockTableName: '',
        })).toThrow('WINE_STOCK_TABLE_NAME is required');
    });

    it('queries and paginates the authenticated user assessment-history index', async () => {
        const lastEvaluatedKey = {
            pk: 'USER#user-1',
            sk: 'ASSESSMENT#key-1',
            gsi1pk: 'USER#user-1#ASSESSMENTS',
            gsi1sk: 'CREATED#2026-01-01T00:00:00.000Z#ASSESSMENT#key-1',
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({
                    Items: [{ assessmentInputKey: 'key-1' }],
                    LastEvaluatedKey: lastEvaluatedKey,
                })
                .mockResolvedValueOnce({
                    Items: [{ assessmentInputKey: 'key-2' }],
                }),
        };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        const result = await store.listCompletedAssessmentsByUser({
            userId: 'user-1',
        });

        expect(result).toEqual([
            { assessmentInputKey: 'key-1' },
            { assessmentInputKey: 'key-2' },
        ]);
        expect(client.send.mock.calls.map(([command]) => command))
            .toEqual([expect.any(QueryCommand), expect.any(QueryCommand)]);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI1',
            KeyConditionExpression: '#gsi1pk = :gsi1pk',
            ExpressionAttributeNames: {
                '#gsi1pk': 'gsi1pk',
            },
            ExpressionAttributeValues: {
                ':gsi1pk': 'USER#user-1#ASSESSMENTS',
            },
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey)
            .toEqual(lastEvaluatedKey);
    });

    it('queries source history through the user-and-source index', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Items: [{ assessmentVersion: 3 }],
            }),
        };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        const result = await store.listCompletedAssessmentsBySource({
            userId: 'user-2',
            sourceKey: 'retailer:tws:wine-1',
        });

        expect(result).toEqual([{ assessmentVersion: 3 }]);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            IndexName: 'GSI2',
            KeyConditionExpression: '#gsi2pk = :gsi2pk',
            ExpressionAttributeNames: {
                '#gsi2pk': 'gsi2pk',
            },
            ExpressionAttributeValues: {
                ':gsi2pk': 'USER#user-2#SOURCE#retailer:tws:wine-1',
            },
        });
    });

    it('reads only the authenticated user current-profile version pointer', async () => {
        const client = {
            send: vi.fn().mockResolvedValue({
                Item: {
                    palateProfileVersion: 7,
                },
            }),
        };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        const result = await store.getCurrentPalateProfileVersion({
            userId: 'user-3',
        });

        expect(result).toBe(7);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'UserData',
            Key: {
                pk: 'USER#user-3',
                sk: 'CURRENT_PALATE_PROFILE',
            },
            ProjectionExpression: '#palateProfileVersion',
            ExpressionAttributeNames: {
                '#palateProfileVersion': 'palateProfileVersion',
            },
        });
    });

    it('returns null when the authenticated user has no current profile pointer', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        await expect(store.getCurrentPalateProfileVersion({
            userId: 'user-1',
        })).resolves.toBeNull();
    });

    it('gets current or removed retailer state with a primary-key read', async () => {
        const listing = {
            sourceKey: 'retailer:tws:wine-99',
            isCurrent: false,
        };
        const client = { send: vi.fn().mockResolvedValue({ Item: listing }) };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        const result = await store.getRetailerWineBySourceKey({
            sourceKey: 'retailer:tws:wine-99',
        });

        expect(result).toBe(listing);
        expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            Key: {
                pk: 'RETAILER#tws',
                sk: 'LISTING#wine-99',
            },
        });
    });

    it('requires user scope and a valid retailer source key before reading', async () => {
        const client = { send: vi.fn() };
        const store = createAssessmentHistoryStore({ client, ...tableNames });

        await expect(store.listCompletedAssessmentsByUser())
            .rejects.toThrow('userId is required');
        await expect(store.listCompletedAssessmentsBySource({ userId: 'user-1' }))
            .rejects.toThrow('sourceKey is required');
        await expect(store.getCurrentPalateProfileVersion())
            .rejects.toThrow('userId is required');
        await expect(store.getRetailerWineBySourceKey({ sourceKey: 'manual:wine-1' }))
            .rejects.toThrow('retailer sourceKey is invalid');
        expect(client.send).not.toHaveBeenCalled();
    });
});

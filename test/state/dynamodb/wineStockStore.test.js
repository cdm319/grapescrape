import { describe, expect, it, vi } from 'vitest';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createWineStockStore } from '@grapescrape/state/dynamodb/wineStockStore';

const wine = {
    id: 'wine-1',
    name: 'Wine One',
    region: 'Bordeaux',
    vintage: 2020,
    price: '25.50',
    grape: 'Merlot',
    alcohol: '13.5%',
    description: 'A wine.',
    sourceHash: 'hash-1',
    rawPayload: { product_code: 'wine-1' },
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-03T04:05:06.000Z'
};

describe('createWineStockStore', () => {
    it('requires a DynamoDB client and table name', () => {
        expect(() => createWineStockStore()).toThrow('DynamoDB client is required');
        expect(() => createWineStockStore({ send: vi.fn() }, '')).toThrow('WINE_STOCK_TABLE_NAME is required');
    });

    it('lists current wines by retailer using the current-listings GSI', async () => {
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Items: [{ id: 'wine-1' }], LastEvaluatedKey: { pk: 'next' } })
                .mockResolvedValueOnce({ Items: [{ id: 'wine-2' }] })
        };

        const result = await createWineStockStore(client, 'WineStock').listCurrentWinesByRetailer('tws');

        expect(result).toEqual([{ id: 'wine-1' }, { id: 'wine-2' }]);
        expect(client.send).toHaveBeenCalledWith(expect.any(QueryCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            IndexName: 'GSI1',
            KeyConditionExpression: 'gsi1pk = :pk',
            ExpressionAttributeValues: {
                ':pk': 'RETAILER#tws#CURRENT'
            },
            ExclusiveStartKey: undefined
        });
        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'next' });
    });

    it('upserts wine listings with an update command that preserves firstSeenAt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createWineStockStore(client, 'WineStock').upsertWineListing({ retailerId: 'tws', wine });

        expect(client.send).not.toHaveBeenCalledWith(expect.any(PutCommand));
        expect(client.send).toHaveBeenCalledWith(expect.any(UpdateCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            Key: {
                pk: 'RETAILER#tws',
                sk: 'LISTING#wine-1',
            },
            UpdateExpression: [
                'SET #entityType = :entityType',
                '#retailerId = :retailerId',
                '#sourceKey = :sourceKey',
                '#id = :id',
                '#name = :name',
                '#region = :region',
                '#vintage = :vintage',
                '#price = :price',
                '#grape = :grape',
                '#alcohol = :alcohol',
                '#description = :description',
                '#sourceHash = :sourceHash',
                '#rawPayload = :rawPayload',
                '#isCurrent = :isCurrent',
                '#firstSeenAt = if_not_exists(#firstSeenAt, :firstSeenAt)',
                '#lastSeenAt = :lastSeenAt',
                '#gsi1pk = :gsi1pk',
                '#gsi1sk = :gsi1sk',
                'REMOVE #lastMissingAt',
            ].join(', ').replace(', REMOVE', ' REMOVE'),
            ExpressionAttributeNames: {
                '#entityType': 'entityType',
                '#retailerId': 'retailerId',
                '#sourceKey': 'sourceKey',
                '#id': 'id',
                '#name': 'name',
                '#region': 'region',
                '#vintage': 'vintage',
                '#price': 'price',
                '#grape': 'grape',
                '#alcohol': 'alcohol',
                '#description': 'description',
                '#sourceHash': 'sourceHash',
                '#rawPayload': 'rawPayload',
                '#isCurrent': 'isCurrent',
                '#firstSeenAt': 'firstSeenAt',
                '#lastSeenAt': 'lastSeenAt',
                '#gsi1pk': 'gsi1pk',
                '#gsi1sk': 'gsi1sk',
                '#lastMissingAt': 'lastMissingAt',
            },
            ExpressionAttributeValues: {
                ':entityType': 'RetailerListing',
                ':retailerId': 'tws',
                ':sourceKey': 'retailer:tws:wine-1',
                ':id': 'wine-1',
                ':name': 'Wine One',
                ':region': 'Bordeaux',
                ':vintage': 2020,
                ':price': '25.50',
                ':grape': 'Merlot',
                ':alcohol': '13.5%',
                ':description': 'A wine.',
                ':sourceHash': 'hash-1',
                ':rawPayload': { product_code: 'wine-1' },
                ':isCurrent': true,
                ':firstSeenAt': '2026-01-01T00:00:00.000Z',
                ':lastSeenAt': '2026-01-03T04:05:06.000Z',
                ':gsi1pk': 'RETAILER#tws#CURRENT',
                ':gsi1sk': 'PRICE#000025.50#LISTING#wine-1',
            }
        });

        vi.useRealTimers();
    });

    it('uses generated timestamps when incoming wine timestamps are not provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        const client = { send: vi.fn().mockResolvedValue({}) };
        const { firstSeenAt, lastSeenAt, ...wineWithoutTimestamps } = wine;

        await createWineStockStore(client, 'WineStock').upsertWineListing({
            retailerId: 'tws',
            wine: wineWithoutTimestamps,
        });

        expect(client.send.mock.calls[0][0].input.ExpressionAttributeValues).toMatchObject({
            ':firstSeenAt': '2026-01-02T03:04:05.000Z',
            ':lastSeenAt': '2026-01-02T03:04:05.000Z',
        });

        vi.useRealTimers();
    });

    it('does not include undefined optional wine fields in upsert expressions', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };
        const { alcohol, rawPayload, ...wineWithMissingFields } = wine;

        await createWineStockStore(client, 'WineStock').upsertWineListing({
            retailerId: 'tws',
            wine: wineWithMissingFields,
        });

        const input = client.send.mock.calls[0][0].input;
        expect(input.UpdateExpression).not.toContain('#alcohol');
        expect(input.UpdateExpression).not.toContain('#rawPayload');
        expect(input.ExpressionAttributeNames).not.toHaveProperty('#alcohol');
        expect(input.ExpressionAttributeNames).not.toHaveProperty('#rawPayload');
        expect(input.ExpressionAttributeValues).not.toHaveProperty(':alcohol');
        expect(input.ExpressionAttributeValues).not.toHaveProperty(':rawPayload');
    });

    it('upserts all provided wine listings', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createWineStockStore(client, 'WineStock').upsertWineListings({
            retailerId: 'tws',
            wines: [
                wine,
                { ...wine, id: 'wine-2', price: '30' },
            ],
        });

        expect(client.send).toHaveBeenCalledTimes(2);
        expect(client.send.mock.calls.map(call => call[0])).toEqual([
            expect.any(UpdateCommand),
            expect.any(UpdateCommand),
        ]);
        expect(client.send.mock.calls.map(call => call[0].input.Key)).toEqual([
            { pk: 'RETAILER#tws', sk: 'LISTING#wine-1' },
            { pk: 'RETAILER#tws', sk: 'LISTING#wine-2' },
        ]);
    });

    it('marks a listing missing and removes it from the current-listings GSI', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createWineStockStore(client, 'WineStock').markListingMissing({
            retailerId: 'tws',
            wineId: 'wine-1',
            missingAt: '2026-01-02T03:04:05.000Z'
        });

        expect(client.send).toHaveBeenCalledWith(expect.any(UpdateCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'WineStock',
            Key: {
                pk: 'RETAILER#tws',
                sk: 'LISTING#wine-1'
            },
            UpdateExpression: 'SET isCurrent = :false, lastMissingAt = :missingAt REMOVE gsi1pk, gsi1sk',
            ExpressionAttributeValues: {
                ':false': false,
                ':missingAt': '2026-01-02T03:04:05.000Z'
            }
        });
    });

    it('marks multiple listings missing with the same timestamp', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createWineStockStore(client, 'WineStock').markListingsMissing({
            retailerId: 'tws',
            wines: [{ id: 'wine-1' }, { id: 'wine-2' }]
        });

        expect(client.send).toHaveBeenCalledTimes(2);
        expect(client.send.mock.calls.map(call => call[0].input.ExpressionAttributeValues[':missingAt']))
            .toEqual(['2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z']);

        vi.useRealTimers();
    });
});

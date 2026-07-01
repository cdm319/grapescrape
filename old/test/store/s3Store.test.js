import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
const getMock = vi.fn();
const putMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(function () { return { send: sendMock } }),
    GetObjectCommand: getMock,
    PutObjectCommand: putMock
}));

const { createS3Store } = await import('../../src/store/s3Store.js');

describe('createS3Store', () => {
    beforeEach(() => {
        sendMock.mockReset();
    });

    it('should throw when bucket is missing', () => {
        expect(() => createS3Store({ bucket: '', key: 'state/results.json' }))
            .toThrow('Bucket and key are required');
    });

    it('should throw when key is missing', () => {
        expect(() => createS3Store({ bucket: 'grapescrape-state', key: '' }))
            .toThrow('Bucket and key are required');
    });

    it('should send a GetObjectCommand when load is called', async () => {
        sendMock.mockResolvedValue({
            Body: {
                transformToString: vi.fn().mockResolvedValue(JSON.stringify([{ id: 'ABC001', name: 'Test Wine' }]))}
            }
        );

        const store = createS3Store({ bucket: 'grapescrape-state', key: 'state/results.json' });

        await store.load();

        expect(getMock).toHaveBeenCalledWith({ Bucket: 'grapescrape-state', Key: 'state/results.json' });
        expect(sendMock).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should return an empty array if load is called but file does not exist', async () => {
        const error = new Error('Not found');
        error.name = 'NoSuchKey';

        sendMock.mockRejectedValue(error);

        const store = createS3Store({
            bucket: 'test-bucket',
            key: 'state/results.json'
        });

        await expect(store.load()).resolves.toEqual([]);
    });

    it('should throw any other error from load', async () => {
        const error = new Error('Some error');
        error.name = 'Some error';

        sendMock.mockRejectedValue(error);

        const store = createS3Store({
            bucket: 'test-bucket',
            key: 'state/results.json'
        });

        await expect(store.load()).rejects.toBe(error);
    });

    it('should send a PutObjectCommand when save is called', async () => {
        const store = createS3Store({ bucket: 'grapescrape-state', key: 'state/results.json' });
        const data = [{ id: 'ABC001', name: 'Test Wine' }];

        await store.save(data);

        expect(putMock).toHaveBeenCalledWith({
            Bucket: 'grapescrape-state',
            Key: 'state/results.json',
            Body: JSON.stringify(data, null, 2),
            ContentType: 'application/json'
        });

        expect(sendMock).toHaveBeenCalledWith(expect.any(Object));
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createAssessmentQueue } from '@grapescrape/state/sqs/assessmentQueue';

const validRequest = {
    requestId: 'request-1',
    source: { type: 'retailer', key: 'retailer:tws:wine-1' },
    wineSnapshot: { id: 'wine-1', name: 'Wine One', sourceHash: 'source-hash' },
    sourceHash: 'source-hash',
    assessmentVersion: 1,
    requestedAt: '2026-01-02T03:04:05.000Z'
};

describe('createAssessmentQueue', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('requires an SQS client and queue URL', () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', '');

        expect(() => createAssessmentQueue()).toThrow('AWS SQS client is required.');
        expect(() => createAssessmentQueue({ send: vi.fn() })).toThrow('Assessment queue URL is required.');
    });

    it('serializes AssessmentRequested events to SendMessageCommand', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createAssessmentQueue(client).enqueueAssessmentRequest(validRequest);

        expect(client.send).toHaveBeenCalledWith(expect.any(SendMessageCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            QueueUrl: 'https://sqs.example/assessment',
            MessageBody: expect.any(String)
        });
        expect(JSON.parse(client.send.mock.calls[0][0].input.MessageBody)).toEqual({
            ...validRequest,
            eventType: 'AssessmentRequested'
        });
    });

    it('does not require userId', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createAssessmentQueue(client).enqueueAssessmentRequest(validRequest);

        const body = JSON.parse(client.send.mock.calls[0][0].input.MessageBody);
        expect(body.userId).toBeUndefined();
    });

    it('prevents request input from overriding the adapter-owned event type', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createAssessmentQueue(client).enqueueAssessmentRequest({
            ...validRequest,
            eventType: 'SomethingElse'
        });

        const body = JSON.parse(client.send.mock.calls[0][0].input.MessageBody);
        expect(body.eventType).toBe('AssessmentRequested');
    });

    it.each([
        ['requestId', { requestId: '' }, 'Invalid AssessmentQueueRequest: requestId is required'],
        ['source.type', { source: { key: 'retailer:tws:wine-1' } }, 'Invalid AssessmentQueueRequest: source.type is required'],
        ['source.key', { source: { type: 'retailer' } }, 'Invalid AssessmentQueueRequest: source.key is required'],
        ['wineSnapshot', { wineSnapshot: undefined }, 'Invalid AssessmentQueueRequest: wineSnapshot is required'],
        ['sourceHash', { sourceHash: '' }, 'Invalid AssessmentQueueRequest: sourceHash is required'],
        ['assessmentVersion', { assessmentVersion: undefined }, 'Invalid AssessmentQueueRequest: assessmentVersion is required']
    ])('validates %s before sending', async (_field, override, expectedError) => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await expect(createAssessmentQueue(client).enqueueAssessmentRequest({
            ...validRequest,
            ...override
        })).rejects.toThrow(expectedError);

        expect(client.send).not.toHaveBeenCalled();
    });

    it('rejects a wineSnapshot sourceHash that does not match the top-level sourceHash', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await expect(createAssessmentQueue(client).enqueueAssessmentRequest({
            ...validRequest,
            wineSnapshot: { ...validRequest.wineSnapshot, sourceHash: 'different-hash' }
        })).rejects.toThrow('Invalid AssessmentQueueRequest: wineSnapshot.sourceHash must match sourceHash');

        expect(client.send).not.toHaveBeenCalled();
    });

    it('sends one message for each assessment request', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await createAssessmentQueue(client).enqueueAssessmentRequests([
            validRequest,
            { ...validRequest, requestId: 'request-2' }
        ]);

        expect(client.send).toHaveBeenCalledTimes(2);
    });
});

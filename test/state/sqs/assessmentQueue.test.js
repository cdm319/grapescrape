import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createAssessmentQueue } from '@grapescrape/state/sqs/assessmentQueue';

const validRequest = {
    requestId: 'request-1',
    source: { type: 'retailer', key: 'retailer:tws:wine-1' },
    wine: { id: 'wine-1', name: 'Wine One' },
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
            MessageBody: JSON.stringify({
                eventType: 'AssessmentRequested',
                ...validRequest
            })
        });
    });

    it('validates required assessment request fields before sending', async () => {
        vi.stubEnv('ASSESSMENT_QUEUE_URL', 'https://sqs.example/assessment');
        const client = { send: vi.fn().mockResolvedValue({}) };

        await expect(createAssessmentQueue(client).enqueueAssessmentRequest({
            ...validRequest,
            sourceHash: ''
        })).rejects.toThrow('Invalid AssessmentQueueRequest: sourceHash is required');

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

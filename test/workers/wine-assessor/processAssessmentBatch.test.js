import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    processAssessmentBatch,
    resolveAssessmentConcurrency,
} from '@grapescrape/wine-assessor/processAssessmentBatch.js';

const createRecord = messageId => ({
    messageId,
    body: JSON.stringify({
        eventType: 'AssessmentRequested',
        requestId: `request-${ messageId }`,
        source: { type: 'retailer', key: `retailer:tws:${ messageId }` },
        wineSnapshot: { id: messageId, name: 'Test Wine' },
        sourceHash: `source-hash-${ messageId }`,
        assessmentVersion: 1,
    }),
});

describe('processAssessmentBatch', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('returns partial batch failures for only failed records', async () => {
        const processRecord = vi.fn()
            .mockResolvedValueOnce({ status: 'completed' })
            .mockRejectedValueOnce(new Error('bad message'))
            .mockResolvedValueOnce({ status: 'completed' });

        const result = await processAssessmentBatch({
            event: {
                Records: [
                    createRecord('message-1'),
                    createRecord('message-2'),
                    createRecord('message-3'),
                ],
            },
            assessmentStore: {},
            assessmentProvider: {},
            concurrency: 1,
            processRecord,
        });

        expect(result).toEqual({
            batchItemFailures: [
                { itemIdentifier: 'message-2' },
            ],
        });
    });

    it('uses ASSESSMENT_CONCURRENCY and defaults to 10', () => {
        expect(resolveAssessmentConcurrency()).toBe(10);
        expect(resolveAssessmentConcurrency('')).toBe(10);
        expect(resolveAssessmentConcurrency('not-a-number')).toBe(10);
        expect(resolveAssessmentConcurrency('0')).toBe(10);
        expect(resolveAssessmentConcurrency('4')).toBe(4);
        expect(resolveAssessmentConcurrency('20')).toBe(10);
    });

    it('processes records with bounded in-batch concurrency', async () => {
        let activeCount = 0;
        let maxActiveCount = 0;
        const processRecord = vi.fn(async () => {
            activeCount += 1;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            await new Promise(resolve => setTimeout(resolve, 1));
            activeCount -= 1;
        });

        await processAssessmentBatch({
            event: {
                Records: [
                    createRecord('message-1'),
                    createRecord('message-2'),
                    createRecord('message-3'),
                    createRecord('message-4'),
                    createRecord('message-5'),
                ],
            },
            assessmentStore: {},
            assessmentProvider: {},
            concurrency: 2,
            processRecord,
        });

        expect(processRecord).toHaveBeenCalledTimes(5);
        expect(maxActiveCount).toBe(2);
    });

    it('defaults in-batch concurrency to 10 records', async () => {
        vi.stubEnv('ASSESSMENT_CONCURRENCY', '');
        let activeCount = 0;
        let maxActiveCount = 0;
        const records = Array.from({ length: 10 }, (_, index) => createRecord(`message-${ index + 1 }`));
        const processRecord = vi.fn(async () => {
            activeCount += 1;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            await new Promise(resolve => setTimeout(resolve, 1));
            activeCount -= 1;
        });

        await processAssessmentBatch({
            event: { Records: records },
            assessmentStore: {},
            assessmentProvider: {},
            processRecord,
        });

        expect(processRecord).toHaveBeenCalledTimes(10);
        expect(maxActiveCount).toBe(10);
    });

    it('reports invalid JSON body as a batch item failure through the real record processor', async () => {
        const result = await processAssessmentBatch({
            event: {
                Records: [
                    { messageId: 'message-1', body: '{not-json' },
                ],
            },
            assessmentStore: {
                getCurrentPalateProfile: vi.fn(),
            },
            assessmentProvider: {
                assessWine: vi.fn(),
            },
            defaultUserId: 'user-1',
            concurrency: 1,
        });

        expect(result).toEqual({
            batchItemFailures: [
                { itemIdentifier: 'message-1' },
            ],
        });
    });

    it('reports missing required message fields as batch item failures', async () => {
        const result = await processAssessmentBatch({
            event: {
                Records: [
                    {
                        ...createRecord('message-1'),
                        body: JSON.stringify({
                            eventType: 'AssessmentRequested',
                            source: { type: 'retailer', key: 'retailer:tws:message-1' },
                            wineSnapshot: { id: 'message-1', name: 'Test Wine' },
                            sourceHash: 'source-hash-message-1',
                            assessmentVersion: 1,
                        }),
                    },
                ],
            },
            assessmentStore: {
                getCurrentPalateProfile: vi.fn(),
            },
            assessmentProvider: {
                assessWine: vi.fn(),
            },
            defaultUserId: 'user-1',
            concurrency: 1,
        });

        expect(result).toEqual({
            batchItemFailures: [
                { itemIdentifier: 'message-1' },
            ],
        });
    });

    it('reports missing user ID as a batch item failure', async () => {
        const result = await processAssessmentBatch({
            event: {
                Records: [
                    createRecord('message-1'),
                ],
            },
            assessmentStore: {
                getCurrentPalateProfile: vi.fn(),
            },
            assessmentProvider: {
                assessWine: vi.fn(),
            },
            defaultUserId: undefined,
            concurrency: 1,
        });

        expect(result).toEqual({
            batchItemFailures: [
                { itemIdentifier: 'message-1' },
            ],
        });
    });

    it('reports OpenAI provider failures as batch item failures', async () => {
        const result = await processAssessmentBatch({
            event: {
                Records: [
                    createRecord('message-1'),
                ],
            },
            assessmentStore: {
                getCurrentPalateProfile: vi.fn().mockResolvedValue({
                    userId: 'user-1',
                    palateProfileVersion: 1,
                }),
                getAssessmentByInputKey: vi.fn().mockResolvedValue(undefined),
                putCompletedAssessment: vi.fn().mockResolvedValue(undefined),
            },
            assessmentProvider: {
                assessWine: vi.fn().mockRejectedValue(new Error('OpenAI unavailable')),
            },
            defaultUserId: 'user-1',
            concurrency: 1,
        });

        expect(result).toEqual({
            batchItemFailures: [
                { itemIdentifier: 'message-1' },
            ],
        });
    });
});

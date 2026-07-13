import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssessmentInputKey } from '@grapescrape/domain/assessment/createAssessmentInputKey';
import { processAssessmentRequest } from '@grapescrape/wine-assessor/processAssessmentRequest.js';

const wineSnapshot = {
    id: 'wine-1',
    name: 'Test Wine',
    sourceHash: 'source-hash-1',
};

const palateProfile = {
    userId: 'user-1',
    palateProfileVersion: 7,
    palateProfile: {
        likes: ['Bordeaux'],
    },
};

const assessment = {
    fit: 'strong',
    highlight: true,
    confidence: 0.9,
    headline: 'A good match',
    summary: 'Likely to suit the profile.',
};

const message = {
    eventType: 'AssessmentRequested',
    requestId: 'request-1',
    source: { type: 'retailer', key: 'retailer:tws:wine-1' },
    wineSnapshot,
    sourceHash: 'source-hash-1',
    assessmentVersion: 2,
    requestedAt: '2026-01-02T03:04:04.000Z',
    reason: 'new_retailer_listing',
};

const createRecord = (body = message) => ({
    messageId: 'message-1',
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

const createContext = ({
    currentPalateProfile = palateProfile,
    existingAssessment,
    providerAssessment = assessment,
    putCompletedAssessment = vi.fn().mockResolvedValue(undefined),
} = {}) => {
    const assessmentStore = {
        getCurrentPalateProfile: vi.fn().mockResolvedValue(currentPalateProfile),
        getAssessmentByInputKey: vi.fn().mockResolvedValue(existingAssessment),
        putCompletedAssessment,
    };
    const assessmentProvider = {
        assessWine: vi.fn().mockResolvedValue(providerAssessment),
    };

    return { assessmentStore, assessmentProvider };
};

const expectedAssessmentInputKey = ({
    userId = 'user-1',
    profileVersion = 7,
    assessmentVersion = 2,
    sourceHash = 'source-hash-1',
} = {}) => createAssessmentInputKey({
    userId,
    sourceKey: 'retailer:tws:wine-1',
    palateProfileVersion: profileVersion,
    assessmentVersion,
    sourceHash,
});

describe('processAssessmentRequest', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('processes a missing assessment and writes the completed assessment item', async () => {
        const context = createContext();

        const result = await processAssessmentRequest({
            record: createRecord(),
            ...context,
            defaultUserId: 'user-1',
            model: 'gpt-test',
            now: () => '2026-01-02T03:04:05.000Z',
        });

        const assessmentInputKey = expectedAssessmentInputKey();
        expect(result).toEqual({ status: 'completed', assessmentInputKey });
        expect(context.assessmentStore.getCurrentPalateProfile).toHaveBeenCalledWith('user-1');
        expect(context.assessmentStore.getAssessmentByInputKey).toHaveBeenCalledWith({
            userId: 'user-1',
            assessmentInputKey,
        });
        expect(context.assessmentProvider.assessWine).toHaveBeenCalledWith({
            wine: wineSnapshot,
            palateProfile,
        });
        expect(context.assessmentStore.putCompletedAssessment).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-1',
            assessmentInputKey,
            source: { type: 'retailer', key: 'retailer:tws:wine-1' },
            wineSnapshot,
            sourceHash: 'source-hash-1',
            palateProfileVersion: 7,
            assessmentVersion: 2,
            model: 'gpt-test',
            assessment,
            status: 'completed',
            createdAt: '2026-01-02T03:04:05.000Z',
            completedAt: '2026-01-02T03:04:05.000Z',
        }));
    });

    it('skips an existing completed assessment without calling OpenAI', async () => {
        const assessmentInputKey = expectedAssessmentInputKey();
        const context = createContext({
            existingAssessment: {
                assessmentInputKey,
                status: 'completed',
            },
        });

        const result = await processAssessmentRequest({
            record: createRecord({ ...message, forceReassessment: true }),
            ...context,
            defaultUserId: 'user-1',
            model: 'gpt-test',
        });

        expect(result).toEqual({
            status: 'skipped_existing_assessment',
            assessmentInputKey,
        });
        expect(context.assessmentProvider.assessWine).not.toHaveBeenCalled();
        expect(context.assessmentStore.putCompletedAssessment).not.toHaveBeenCalled();
    });

    it('treats a completed-assessment conditional write conflict as success', async () => {
        const conflict = new Error('already exists');
        conflict.name = 'CompletedAssessmentConflictError';
        conflict.isConditionalConflict = true;
        const context = createContext({
            putCompletedAssessment: vi.fn().mockRejectedValue(conflict),
        });

        const result = await processAssessmentRequest({
            record: createRecord(),
            ...context,
            defaultUserId: 'user-1',
            model: 'gpt-test',
        });

        expect(result).toEqual({
            status: 'skipped_conflicting_completed_assessment',
            assessmentInputKey: expectedAssessmentInputKey(),
        });
    });

    it('fails when required message fields are missing', async () => {
        const context = createContext();

        await expect(processAssessmentRequest({
            record: createRecord({ ...message, requestId: undefined }),
            ...context,
            defaultUserId: 'user-1',
        })).rejects.toThrow('requestId is required');

        expect(context.assessmentStore.getCurrentPalateProfile).not.toHaveBeenCalled();
    });

    it('fails when neither message userId nor DEFAULT_USER_ID is available', async () => {
        const context = createContext();

        await expect(processAssessmentRequest({
            record: createRecord(),
            ...context,
            defaultUserId: undefined,
        })).rejects.toThrow('userId or DEFAULT_USER_ID is required');
    });

    it('uses message.userId instead of DEFAULT_USER_ID', async () => {
        const context = createContext({
            currentPalateProfile: {
                ...palateProfile,
                userId: 'message-user',
                palateProfileVersion: 3,
            },
        });

        await processAssessmentRequest({
            record: createRecord({ ...message, userId: 'message-user' }),
            ...context,
            defaultUserId: 'default-user',
            model: 'gpt-test',
        });

        expect(context.assessmentStore.getCurrentPalateProfile).toHaveBeenCalledWith('message-user');
        expect(context.assessmentStore.putCompletedAssessment).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'message-user',
            assessmentInputKey: expectedAssessmentInputKey({
                userId: 'message-user',
                profileVersion: 3,
            }),
        }));
    });

    it('uses the current palate profile version at processing time', async () => {
        const context = createContext({
            currentPalateProfile: {
                ...palateProfile,
                palateProfileVersion: 9,
            },
        });

        await processAssessmentRequest({
            record: createRecord({ ...message, palateProfileVersion: 1 }),
            ...context,
            defaultUserId: 'user-1',
            model: 'gpt-test',
        });

        expect(context.assessmentStore.putCompletedAssessment).toHaveBeenCalledWith(expect.objectContaining({
            palateProfileVersion: 9,
            assessmentInputKey: expectedAssessmentInputKey({ profileVersion: 9 }),
        }));
    });

    it('fails when the OpenAI provider fails and does not persist a failed assessment', async () => {
        const context = createContext();
        context.assessmentProvider.assessWine.mockRejectedValue(new Error('OpenAI unavailable'));

        await expect(processAssessmentRequest({
            record: createRecord(),
            ...context,
            defaultUserId: 'user-1',
            model: 'gpt-test',
        })).rejects.toThrow('OpenAI unavailable');

        expect(context.assessmentStore.putCompletedAssessment).not.toHaveBeenCalled();
    });

    it('fails when wineSnapshot.sourceHash does not match sourceHash', async () => {
        const context = createContext();

        await expect(processAssessmentRequest({
            record: createRecord({
                ...message,
                wineSnapshot: {
                    ...wineSnapshot,
                    sourceHash: 'different-source-hash',
                },
            }),
            ...context,
            defaultUserId: 'user-1',
        })).rejects.toThrow('wineSnapshot.sourceHash must match sourceHash');
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssessmentEnricher } from '../../src/assess/assessmentEnricher.js';

const createStore = initial => ({
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
});

const createLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});

const palateProfile = {
    version: 1,
    summary: 'Likes ripe plush reds',
};

const createWine = id => ({
    id,
    name: `Test Wine ${id}`,
    vintage: 2020,
    region: 'Bordeaux',
    grape: 'Merlot',
    alcohol: '13.5%',
    description: 'Ripe and supple',
});

describe('createAssessmentEnricher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('assesses uncached wines and saves them to cache', async () => {
        const store = createStore({});
        const logger = createLogger();
        const provider = {
            assessWine: vi.fn().mockResolvedValue({
                fit: 'strong',
                confidence: 'high',
                highlight: true,
                summary: 'Looks like a strong match',
                reasons: ['Ripe fruit'],
                cautions: [],
            }),
        };

        const enricher = createAssessmentEnricher({
            store,
            provider,
            palateProfile,
            model: 'test-model',
            logger,
        });

        const wine = createWine('ABC123');

        const matches = await enricher.assessWines([wine]);

        expect(provider.assessWine).toHaveBeenCalledWith({
            wine,
            palateProfile,
        });

        expect(store.save).toHaveBeenCalledWith({
            ABC123: expect.objectContaining({
                assessmentVersion: 1,
                palateProfileVersion: 1,
                model: 'test-model',
                wine,
                assessment: expect.objectContaining({
                    fit: 'strong',
                    confidence: 'high',
                }),
            }),
        });

        expect(matches).toEqual([
            {
                wine,
                assessment: expect.objectContaining({
                    fit: 'strong',
                    confidence: 'high',
                }),
            },
        ]);
    });

    it('reuses valid cached assessments without returning cached highlights', async () => {
        const wine = createWine('ABC123');

        const firstStore = createStore({});
        const firstProvider = {
            assessWine: vi.fn().mockResolvedValue({
                fit: 'good',
                confidence: 'medium_high',
                highlight: true,
                summary: 'Good match',
                reasons: [],
                cautions: [],
            }),
        };

        const firstEnricher = createAssessmentEnricher({
            store: firstStore,
            provider: firstProvider,
            palateProfile,
            logger: createLogger(),
        });

        await firstEnricher.assessWines([wine]);

        const savedCache = firstStore.save.mock.calls[0][0];

        const secondStore = createStore(savedCache);
        const secondProvider = {
            assessWine: vi.fn(),
        };

        const secondEnricher = createAssessmentEnricher({
            store: secondStore,
            provider: secondProvider,
            palateProfile,
            logger: createLogger(),
        });

        const matches = await secondEnricher.assessWines([wine]);

        expect(secondProvider.assessWine).not.toHaveBeenCalled();
        expect(matches).toEqual([]);
    });

    it('continues when one assessment fails', async () => {
        const store = createStore({});
        const logger = createLogger();
        const provider = {
            assessWine: vi.fn()
                .mockRejectedValueOnce(new Error('OpenAI failed'))
                .mockResolvedValueOnce({
                    fit: 'strong',
                    confidence: 'high',
                    highlight: true,
                    summary: 'Strong match',
                    reasons: [],
                    cautions: [],
                }),
        };

        const wines = [
            { id: 'A', name: 'A', description: 'Bad call' },
            { id: 'B', name: 'B', description: 'Good call' },
        ];

        const enricher = createAssessmentEnricher({
            store,
            provider,
            palateProfile,
            logger,
        });

        const matches = await enricher.assessWines(wines);

        expect(logger.error).toHaveBeenCalled();
        expect(matches).toHaveLength(1);
        expect(matches[0].wine.id).toBe('B');
    });

    it('respects the maximum assessments per run', async () => {
        const store = createStore({});
        const logger = createLogger();
        const provider = {
            assessWine: vi.fn().mockResolvedValue({
                fit: 'maybe',
                confidence: 'medium',
                highlight: false,
                summary: 'Not highlighted',
                reasons: [],
                cautions: [],
            }),
        };

        const enricher = createAssessmentEnricher({
            store,
            provider,
            palateProfile,
            maxAssessmentsPerRun: 2,
            logger,
        });

        await enricher.assessWines([
            createWine('A'),
            createWine('B'),
            createWine('C'),
        ]);

        expect(provider.assessWine).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(
            'Skipping assessment due to MAX_ASSESSMENTS_PER_RUN',
            expect.objectContaining({ wineId: 'C' })
        );
    });

    it('runs assessments with bounded concurrency', async () => {
        const store = createStore({});
        const logger = createLogger();
        let active = 0;
        let maxActive = 0;

        const provider = {
            assessWine: vi.fn().mockImplementation(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);

                await new Promise(resolve => setTimeout(resolve, 1));

                active -= 1;

                return {
                    fit: 'maybe',
                    confidence: 'medium',
                    highlight: false,
                    summary: 'Not highlighted',
                    reasons: [],
                    cautions: [],
                };
            }),
        };

        const enricher = createAssessmentEnricher({
            store,
            provider,
            palateProfile,
            assessmentConcurrency: 2,
            logger,
        });

        await enricher.assessWines([
            createWine('A'),
            createWine('B'),
            createWine('C'),
            createWine('D'),
        ]);

        expect(provider.assessWine).toHaveBeenCalledTimes(4);
        expect(maxActive).toBe(2);
    });
});

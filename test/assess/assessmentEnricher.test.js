import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import { createAssessmentEnricher } from '../../src/assess/assessmentEnricher.js';

const createStore = initial => ({
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
});

const palateProfile = {
    version: 1,
    summary: 'Likes ripe plush reds',
};

describe('createAssessmentEnricher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('assesses uncached added wines and saves them to cache', async () => {
        const store = createStore({});
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
            model: 'test-model'
        });

        const wine = {
            id: 'ABC123',
            name: 'Test Wine',
            vintage: 2020,
            region: 'Bordeaux',
            grape: 'Merlot',
            alcohol: '13.5%',
            description: 'Ripe and supple',
        };

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

    it('reuses valid cached assessments', async () => {
        const wine = {
            id: 'ABC123',
            name: 'Test Wine',
            vintage: 2020,
            region: 'Bordeaux',
            grape: 'Merlot',
            alcohol: '13.5%',
            description: 'Ripe and supple',
        };

        // Create the first run to get the real sourceHash.
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
        });

        const matches = await secondEnricher.assessWines([wine]);

        expect(secondProvider.assessWine).not.toHaveBeenCalled();
        expect(matches).toHaveLength(1);
    });

    it('continues when one assessment fails', async () => {
        const store = createStore({});
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
            palateProfile
        });

        const matches = await enricher.assessWines(wines);

        expect(console.error).toHaveBeenCalled();
        expect(matches).toHaveLength(1);
        expect(matches[0].wine.id).toBe('B');
    });
});

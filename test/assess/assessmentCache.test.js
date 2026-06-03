import { describe, expect, it } from 'vitest';
import {
    createAssessmentSourceHash,
    isCachedAssessmentValid,
    shouldHighlightAssessment,
} from '../../src/assess/assessmentCache.js';

describe('assessmentCache', () => {
    it('creates the same hash for the same assessment-relevant wine fields', () => {
        const wine = {
            id: 'ABC123',
            name: 'Test Wine',
            vintage: 2020,
            region: 'Bordeaux',
            grape: 'Merlot',
            alcohol: '13.5%',
            description: 'Ripe and supple',
            price: '25.00',
        };

        expect(createAssessmentSourceHash(wine)).toBe(createAssessmentSourceHash({
            ...wine,
            price: '30.00',
        }));
    });

    it('invalidates cached assessments when the source hash changes', () => {
        expect(isCachedAssessmentValid({
            cached: {
                assessmentVersion: 1,
                palateProfileVersion: 1,
                sourceHash: 'old',
            },
            sourceHash: 'new',
            palateProfileVersion: 1,
            assessmentVersion: 1,
        })).toBe(false);
    });

    it('highlights strong high-confidence assessments', () => {
        expect(shouldHighlightAssessment({
            fit: 'strong',
            confidence: 'high',
            highlight: true,
        })).toBe(true);
    });
});

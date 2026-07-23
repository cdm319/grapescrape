import { describe, expect, it } from 'vitest';
import { presentManualWine } from '../../src/api/manualWinePresentation.js';

const manualWine = {
    id: 'ffbd54ef-0c8e-49c7-a98e-e6703c08410e',
    sourceKey: 'manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e',
    source: {
        type: 'manual',
        key: 'manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e',
    },
    name: 'Cellar Example',
    vintage: 'NV',
    description: 'Rich red fruit.',
    status: 'active',
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    deletedAt: null,
    sourceHash: 'current-source-hash',
};

const completedAssessment = {
    assessmentInputKey: 'assessment-key',
    sourceKey: manualWine.sourceKey,
    assessmentVersion: 3,
    palateProfileVersion: 4,
    sourceHash: 'current-source-hash',
    completedAt: '2026-07-23T11:00:00.000Z',
    assessment: {
        fit: 'good',
        confidence: 'medium_high',
        highlight: true,
        headline: 'Ripe and polished',
        summary: 'A likely match.',
        reasoningMode: 'description_only',
        reasons: ['Ripe fruit.'],
        cautions: [],
        evidence: [{
            type: 'direct',
            source: 'wine.description',
            text: 'Rich red fruit.',
        }],
        assumptions: [],
        palateAlignment: {
            fruit: 'positive',
            texture: 'neutral',
            oakAndDevelopment: 'unknown',
            structure: 'neutral',
            overall: 'good',
        },
        styleProfile: {
            body: 'medium',
            fruitRipeness: 'ripe',
            fruitCharacter: ['red_fruit'],
            texture: [],
            oakInfluence: 'unknown',
            tannin: 'unknown',
            acidity: 'unknown',
            development: 'unknown',
            styleTags: [],
        },
    },
};

describe('presentManualWine', () => {
    it('presents an unassessed wine without internal source hash data', () => {
        const result = presentManualWine({
            manualWine,
            latestAssessment: undefined,
            currentPalateProfileVersion: 4,
        });

        expect(result).toEqual({
            id: manualWine.id,
            sourceKey: manualWine.sourceKey,
            name: manualWine.name,
            vintage: 'NV',
            description: 'Rich red fruit.',
            status: 'active',
            createdAt: manualWine.createdAt,
            updatedAt: manualWine.updatedAt,
            deletedAt: null,
            latestAssessment: null,
            freshness: {
                status: 'unassessed',
                isCurrent: false,
                profileChanged: false,
                sourceChanged: false,
                assessedPalateProfileVersion: null,
                currentPalateProfileVersion: 4,
            },
        });
        expect(result).not.toHaveProperty('sourceHash');
        expect(result).not.toHaveProperty('source');
    });

    it('returns the complete public assessment and current freshness', () => {
        const result = presentManualWine({
            manualWine,
            latestAssessment: completedAssessment,
            currentPalateProfileVersion: 4,
        });

        expect(result.latestAssessment).toEqual({
            assessmentInputKey: 'assessment-key',
            sourceKey: manualWine.sourceKey,
            assessmentVersion: 3,
            palateProfileVersion: 4,
            ...completedAssessment.assessment,
            completedAt: '2026-07-23T11:00:00.000Z',
        });
        expect(result.freshness).toEqual({
            status: 'current',
            isCurrent: true,
            profileChanged: false,
            sourceChanged: false,
            assessedPalateProfileVersion: 4,
            currentPalateProfileVersion: 4,
        });
        expect(result.latestAssessment).not.toHaveProperty('sourceHash');
    });

    it.each([
        [3, 'current-source-hash', 'palate_profile_changed'],
        [4, 'old-source-hash', 'source_changed'],
        [3, 'old-source-hash', 'palate_profile_and_source_changed'],
    ])('derives changed profile %s and hash %s as %s', (
        palateProfileVersion,
        sourceHash,
        status,
    ) => {
        const result = presentManualWine({
            manualWine,
            latestAssessment: {
                ...completedAssessment,
                palateProfileVersion,
                sourceHash,
            },
            currentPalateProfileVersion: 4,
        });

        expect(result.freshness.status).toBe(status);
        expect(result.freshness.isCurrent).toBe(false);
    });
});

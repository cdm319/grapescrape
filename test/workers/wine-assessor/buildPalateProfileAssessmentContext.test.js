import { describe, expect, it } from 'vitest';
import {
    buildPalateProfileAssessmentContext,
} from '@grapescrape/wine-assessor/buildPalateProfileAssessmentContext.js';

const stylePreferences = {
    body: { preferred: ['full'], avoided: ['light'] },
    fruitRipeness: { preferred: ['ripe'], avoided: ['underripe'] },
    fruitCharacter: { preferred: ['black_fruit'], avoided: [] },
    texture: { preferred: ['plush'], avoided: ['thin'] },
    oakInfluence: { preferred: ['moderate'], avoided: ['none_detected'] },
    tannin: { preferred: ['moderate_plus'], avoided: ['firm_or_drying'] },
    acidity: { preferred: ['balanced'], avoided: ['sharp'] },
    development: { preferred: ['ready_to_drink'], avoided: [] },
    styleTags: { preferred: ['polished'], avoided: ['rustic'] },
};

describe('buildPalateProfileAssessmentContext', () => {
    it('keeps only assessment-relevant profile fields and four-field wine examples', () => {
        const currentPalateProfile = {
            pk: 'USER#user-1',
            sk: 'PALATE_PROFILE#7',
            entityType: 'PalateProfile',
            userId: 'user-1',
            palateProfileVersion: 7,
            palateProfile: {
                stylePreferences,
                wineExamples: [{
                    id: 'c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234',
                    name: 'Example Estate',
                    vintage: '2019',
                    sentiment: 'enjoyed',
                    notes: 'Ripe fruit and a plush texture.',
                    createdAt: '2026-07-23T10:30:00.000Z',
                    retailerId: 'retailer-1',
                    sourceKey: 'retailer:tws:example-estate-2019',
                }],
            },
            createdAt: '2026-07-23T10:30:00.000Z',
            updatedAt: '2026-07-23T10:30:00.000Z',
            gsi1pk: 'USER#user-1#PALATE_PROFILES',
            gsi1sk: 'VERSION#7',
            currentPointer: {
                pk: 'USER#user-1',
                sk: 'CURRENT_PALATE_PROFILE',
                palateProfileVersion: 7,
            },
        };

        const result = buildPalateProfileAssessmentContext(currentPalateProfile);

        expect(result).toEqual({
            palateProfileVersion: 7,
            palateProfile: {
                stylePreferences,
                wineExamples: [{
                    name: 'Example Estate',
                    vintage: '2019',
                    sentiment: 'enjoyed',
                    notes: 'Ripe fruit and a plush texture.',
                }],
            },
        });
        expect(result.palateProfile.stylePreferences).toEqual(stylePreferences);
        expect(result.palateProfile.wineExamples[0]).toEqual({
            name: 'Example Estate',
            vintage: '2019',
            sentiment: 'enjoyed',
            notes: 'Ripe fruit and a plush texture.',
        });
        expect(Object.keys(result.palateProfile.wineExamples[0])).toEqual([
            'name',
            'vintage',
            'sentiment',
            'notes',
        ]);
        expect(currentPalateProfile.palateProfile.wineExamples[0]).toHaveProperty(
            'id',
            'c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234'
        );
    });

    it('keeps legacy assessment profile content without its storage envelope', () => {
        const currentPalateProfile = {
            pk: 'USER#user-1',
            sk: 'PALATE_PROFILE#3',
            entityType: 'PalateProfile',
            userId: 'user-1',
            version: 3,
            palateProfile: {
                likes: ['Bordeaux'],
                summary: 'Likes structured red wines.',
            },
            createdAt: '2025-01-01T00:00:00.000Z',
            currentPointer: {
                pk: 'USER#user-1',
                sk: 'CURRENT_PALATE_PROFILE',
            },
        };

        expect(buildPalateProfileAssessmentContext(currentPalateProfile)).toEqual({
            palateProfileVersion: 3,
            palateProfile: {
                likes: ['Bordeaux'],
                summary: 'Likes structured red wines.',
            },
        });
    });
});

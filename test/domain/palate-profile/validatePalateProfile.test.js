import { describe, expect, it } from 'vitest';
import {
    validatePalateProfile,
} from '@grapescrape/domain/palate-profile/validatePalateProfile';

const stylePreferences = {
    body: {
        preferred: ['medium_plus', 'full'],
        avoided: ['light'],
    },
    fruitRipeness: {
        preferred: ['ripe', 'very_ripe'],
        avoided: ['underripe'],
    },
    fruitCharacter: {
        preferred: ['black_fruit', 'plum'],
        avoided: [],
    },
    texture: {
        preferred: ['plush', 'velvety'],
        avoided: ['austere', 'thin'],
    },
    oakInfluence: {
        preferred: ['moderate', 'pronounced'],
        avoided: ['none_detected'],
    },
    tannin: {
        preferred: ['moderate', 'moderate_plus'],
        avoided: ['firm_or_drying'],
    },
    acidity: {
        preferred: ['balanced', 'fresh'],
        avoided: ['sharp'],
    },
    development: {
        preferred: ['ready_to_drink', 'developing'],
        avoided: [],
    },
    styleTags: {
        preferred: ['fruit_forward', 'opulent', 'polished'],
        avoided: ['rustic'],
    },
};

const wineExample = {
    id: 'c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234',
    name: 'Example Estate',
    vintage: '2019',
    sentiment: 'enjoyed',
    notes: 'Ripe fruit and a plush texture.',
};

const validProfile = () => ({
    stylePreferences: structuredClone(stylePreferences),
    wineExamples: [{ ...wineExample }],
});

describe('validatePalateProfile', () => {
    it('accepts the complete structured profile contract', () => {
        expect(validatePalateProfile(validProfile())).toEqual({
            valid: true,
            errors: [],
        });
    });

    it('requires every style dimension and rejects unknown dimensions', () => {
        for (const dimension of Object.keys(stylePreferences)) {
            const profile = validProfile();
            delete profile.stylePreferences[dimension];

            expect(validatePalateProfile(profile)).toMatchObject({
                valid: false,
                errors: expect.arrayContaining([
                    {
                        field: `profile.stylePreferences.${ dimension }`,
                        reason: 'is required',
                    },
                ]),
            });
        }

        const profile = validProfile();
        profile.stylePreferences.colour = {
            preferred: ['red'],
            avoided: [],
        };

        expect(validatePalateProfile(profile).errors).toContainEqual({
            field: 'profile.stylePreferences.colour',
            reason: 'is not allowed',
        });
    });

    it('rejects values outside every dimension-specific enum', () => {
        for (const dimension of Object.keys(stylePreferences)) {
            const profile = validProfile();
            profile.stylePreferences[dimension].preferred = ['unknown'];

            expect(validatePalateProfile(profile)).toMatchObject({
                valid: false,
                errors: expect.arrayContaining([
                    {
                        field: `profile.stylePreferences.${ dimension }.preferred[0]`,
                        reason: 'must be an allowed style value',
                    },
                ]),
            });
        }
    });

    it('allows empty preference arrays but rejects duplicates and overlap', () => {
        const emptyProfile = validProfile();

        for (const preference of Object.values(emptyProfile.stylePreferences)) {
            preference.preferred = [];
            preference.avoided = [];
        }

        expect(validatePalateProfile(emptyProfile).valid).toBe(true);

        const duplicateProfile = validProfile();
        duplicateProfile.stylePreferences.body.preferred = ['full', 'full'];
        duplicateProfile.stylePreferences.body.avoided = ['full'];

        expect(validatePalateProfile(duplicateProfile).errors).toEqual(
            expect.arrayContaining([
                {
                    field: 'profile.stylePreferences.body.preferred',
                    reason: 'must not contain duplicate values',
                },
                {
                    field: 'profile.stylePreferences.body',
                    reason: 'preferred and avoided values must not overlap',
                },
            ]),
        );
    });

    it.each([
        ['id', 'not-a-uuid', 'must be a UUID'],
        ['name', ' Example Estate', 'must be a trimmed string between 1 and 120 characters'],
        ['name', '', 'must be a trimmed string between 1 and 120 characters'],
        ['vintage', '999', 'must be a year from 1000 through 2999 or NV'],
        ['vintage', 'nv', 'must be a year from 1000 through 2999 or NV'],
        ['vintage', 2019, 'must be a year from 1000 through 2999 or NV'],
        ['sentiment', 'liked', 'must be enjoyed or not_enjoyed'],
        ['notes', 'x'.repeat(401), 'must be a string no longer than 400 characters'],
    ])('rejects an invalid wine-example %s', (field, value, reason) => {
        const profile = validProfile();
        profile.wineExamples[0][field] = value;

        expect(validatePalateProfile(profile).errors).toContainEqual({
            field: `profile.wineExamples[0].${ field }`,
            reason,
        });
    });

    it('accepts canonical NV and empty notes', () => {
        const profile = validProfile();
        profile.wineExamples[0].vintage = 'NV';
        profile.wineExamples[0].notes = '';

        expect(validatePalateProfile(profile).valid).toBe(true);
    });

    it('enforces unique UUIDs and normalised name plus vintage identities', () => {
        const profile = validProfile();
        profile.wineExamples.push({
            ...wineExample,
            id: wineExample.id.toUpperCase(),
            name: 'example   estate',
            sentiment: 'not_enjoyed',
        });

        expect(validatePalateProfile(profile).errors).toEqual(
            expect.arrayContaining([
                {
                    field: 'profile.wineExamples[1].id',
                    reason: 'must be unique within the profile',
                },
                {
                    field: 'profile.wineExamples[1]',
                    reason: 'name and vintage must be unique within the profile',
                },
            ]),
        );

        const unicodeProfile = validProfile();
        unicodeProfile.wineExamples = [
            {
                ...wineExample,
                name: 'Café Estate',
            },
            {
                ...wineExample,
                id: '5fa8279e-9a60-4ea8-afbb-3c977fc9280f',
                name: 'cafe\u0301 estate',
            },
        ];

        expect(validatePalateProfile(unicodeProfile).errors).toContainEqual({
            field: 'profile.wineExamples[1]',
            reason: 'name and vintage must be unique within the profile',
        });
    });

    it.each(['enjoyed', 'not_enjoyed'])(
        'allows no more than 20 %s examples',
        sentiment => {
            const profile = validProfile();
            profile.wineExamples = Array.from({ length: 21 }, (_, index) => ({
                id: `00000000-0000-4000-8000-${ String(index).padStart(12, '0') }`,
                name: `Example ${ index }`,
                vintage: '2020',
                sentiment,
                notes: '',
            }));

            expect(validatePalateProfile(profile).errors).toContainEqual({
                field: 'profile.wineExamples',
                reason: `must contain no more than 20 ${ sentiment } examples`,
            });
        },
    );

    it('rejects unknown fields at every profile level', () => {
        const profile = validProfile();
        profile.userId = 'client-selected-user';
        profile.stylePreferences.body.score = 4;
        profile.wineExamples[0].createdAt = '2026-01-01T00:00:00.000Z';

        expect(validatePalateProfile(profile).errors).toEqual(
            expect.arrayContaining([
                {
                    field: 'profile.userId',
                    reason: 'is not allowed',
                },
                {
                    field: 'profile.stylePreferences.body.score',
                    reason: 'is not allowed',
                },
                {
                    field: 'profile.wineExamples[0].createdAt',
                    reason: 'is not allowed',
                },
            ]),
        );
    });
});

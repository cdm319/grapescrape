import { describe, expect, it } from 'vitest';
import {
    createManualWineIdentity,
    createManualWineSourceHash,
    isManualWineId,
    normaliseManualWineName,
    validateManualWineCreateInput,
    validateManualWinePatchInput,
} from '@grapescrape/domain/wine/manualWine';

describe('manual wine domain helpers', () => {
    it('accepts the exact create shape', () => {
        expect(validateManualWineCreateInput({
            name: 'Cellar Example',
            vintage: 'NV',
            description: '',
        })).toEqual({
            valid: true,
            hasUnknownFields: false,
            errors: [],
        });
    });

    it.each([
        ['name', '', 'must be a trimmed string between 1 and 120 characters'],
        ['name', ' Cellar Example', 'must be a trimmed string between 1 and 120 characters'],
        ['name', 'a'.repeat(121), 'must be a trimmed string between 1 and 120 characters'],
        ['vintage', '999', 'must be a year from 1000 through 2999 or NV'],
        ['vintage', '3000', 'must be a year from 1000 through 2999 or NV'],
        ['vintage', 'nv', 'must be a year from 1000 through 2999 or NV'],
        ['vintage', 2020, 'must be a year from 1000 through 2999 or NV'],
        ['description', 'a'.repeat(2001), 'must be a string no longer than 2000 characters'],
        ['description', null, 'must be a string no longer than 2000 characters'],
    ])('rejects invalid %s value %j', (field, value, reason) => {
        const result = validateManualWineCreateInput({
            name: 'Cellar Example',
            vintage: '2020',
            description: '',
            [field]: value,
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual({
            field,
            reason,
        });
    });

    it('requires every create field and rejects all other wine details', () => {
        const result = validateManualWineCreateInput({
            name: 'Cellar Example',
            region: 'Bordeaux',
            country: 'France',
            grape: 'Merlot',
            alcohol: '14%',
        });

        expect(result.hasUnknownFields).toBe(true);
        expect(result.errors).toEqual([
            { field: 'vintage', reason: 'is required' },
            { field: 'description', reason: 'is required' },
            { field: 'region', reason: 'is not allowed' },
            { field: 'country', reason: 'is not allowed' },
            { field: 'grape', reason: 'is not allowed' },
            { field: 'alcohol', reason: 'is not allowed' },
        ]);
    });

    it('accepts only description in a patch', () => {
        expect(validateManualWinePatchInput({
            description: 'Updated description.',
        }).valid).toBe(true);

        const invalid = validateManualWinePatchInput({
            name: 'Different name',
            vintage: '2021',
            description: 'Updated description.',
        });

        expect(invalid.hasUnknownFields).toBe(true);
        expect(invalid.errors).toEqual([
            { field: 'name', reason: 'is not allowed' },
            { field: 'vintage', reason: 'is not allowed' },
        ]);
    });

    it('uses the canonical normalized name and NUL-separated vintage identity', () => {
        expect(normaliseManualWineName('  Ｃellar   EXAMPLE  '))
            .toBe('cellar example');
        expect(createManualWineIdentity({
            name: '  Ｃellar   EXAMPLE  ',
            vintage: 'NV',
        })).toBe('cellar example\u0000NV');
    });

    it('hashes ordered name, vintage, and description values', () => {
        expect(createManualWineSourceHash({
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Rich red fruit.',
        })).toBe('b508298dda90fdd3bacd09887909e1d13d9bd37dc7b49a023dee0862e22e75c4');

        expect(createManualWineSourceHash({
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Changed.',
        })).not.toBe(createManualWineSourceHash({
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Rich red fruit.',
        }));
    });

    it('recognises canonical UUID path identifiers', () => {
        expect(isManualWineId('ffbd54ef-0c8e-49c7-a98e-e6703c08410e'))
            .toBe(true);
        expect(isManualWineId('not-a-uuid')).toBe(false);
        expect(isManualWineId(42)).toBe(false);
    });
});

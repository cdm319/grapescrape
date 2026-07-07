import { describe, expect, it } from 'vitest';
import { createSourceHash } from '@grapescrape/domain/wine/createSourceHash';

const baseWine = {
    id: 'wine-1',
    name: 'Chateau Example',
    vintage: 2019,
    region: 'Bordeaux',
    alcohol: '13.5%',
    price: '24.00',
    grape: 'Cabernet Sauvignon',
    description: 'A structured red wine.'
};

describe('createSourceHash', () => {
    it('is stable for the same meaningful wine fields', () => {
        expect(createSourceHash(baseWine)).toBe(createSourceHash({ ...baseWine }));
    });

    it('changes when hash-relevant fields change', () => {
        for (const field of ['name', 'vintage', 'region', 'alcohol']) {
            expect(createSourceHash({ ...baseWine, [field]: `${ baseWine[field] } changed` }))
                .not.toBe(createSourceHash(baseWine));
        }
    });

    it('does not change when intentionally ignored fields change', () => {
        const changedIgnoredFields = {
            ...baseWine,
            id: 'wine-2',
            price: '49.00',
            grape: 'Merlot',
            description: 'A different description.',
            rawPayload: { changed: true }
        };

        expect(createSourceHash(changedIgnoredFields)).toBe(createSourceHash(baseWine));
    });

    it('treats missing hash fields consistently as null', () => {
        expect(createSourceHash({ name: 'Chateau Example' }))
            .toBe(createSourceHash({ name: 'Chateau Example', vintage: null, region: null, alcohol: null }));
    });
});

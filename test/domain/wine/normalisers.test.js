import { describe, expect, it } from 'vitest';
import {
    normaliseCurrency,
    normaliseName,
    normaliseVintage
} from '@grapescrape/domain/wine/normalisers';

describe('wine normalisers', () => {
    it('removes a trailing vintage from a wine name', () => {
        expect(normaliseName('Chateau Example, 2019')).toBe('Chateau Example');
        expect(normaliseName('Estate Red 2020')).toBe('Estate Red');
    });

    it('leaves non-trailing years in the wine name', () => {
        expect(normaliseName('Bin 2019 Reserve')).toBe('Bin 2019 Reserve');
    });

    it('normalises vintage text to a number', () => {
        expect(normaliseVintage('2016')).toBe(2016);
        expect(normaliseVintage('2016 vintage')).toBe(2016);
    });

    it('returns null when vintage text cannot be parsed', () => {
        expect(normaliseVintage('NV')).toBeNull();
        expect(normaliseVintage(undefined)).toBeNull();
    });

    it('normalises currency text to two decimal places', () => {
        expect(normaliseCurrency('£19.5 per bottle')).toBe('19.50');
        expect(normaliseCurrency('£22')).toBe('22.00');
    });

    it('returns null for missing or non-string currency values', () => {
        expect(normaliseCurrency('')).toBeNull();
        expect(normaliseCurrency(19.5)).toBeNull();
    });
});

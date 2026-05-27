import { describe, expect, it } from 'vitest';
import {diffWines, normaliseCurrency, normaliseHeader, normaliseName, parseCsv, stripFirstLine} from '../src/utils.js';

describe('stripFirstLine', () => {
    it('should remove the first line from a string', () => {
        const str = 'First line\nSecond line\nThird line';
        const result = stripFirstLine(str);

        expect(result).toBe('Second line\nThird line');
    });

    it('should return an empty string if the input is empty', () => {
        const str = '';
        const result = stripFirstLine(str);

        expect(result).toBe('');
    });

    it('should return the same string if it does not contain a newline', () => {
        const str = 'No newline at the end';
        const result = stripFirstLine(str);

        expect(result).toBe(str);
    });
});

describe('normaliseHeader', () => {
    it('should convert header to lowercase and replace spaces with underscores', () => {
        const header = 'Header With Spaces ';
        const result = normaliseHeader(header);

        expect(result).toBe('header_with_spaces');
    });

    it('should handle empty header', () => {
        const header = '';
        const result = normaliseHeader(header);

        expect(result).toBe('');
    });
});

describe('normaliseName', () => {
    it('should remove the year from the name', () => {
        const name = 'Wine Name 2020';
        const result = normaliseName(name);

        expect(result).toBe('Wine Name');
    });

    it('should ignore numeric characters in the name other than year', () => {
        const name = "Cuvée 319";
        const result = normaliseName(name);

        expect(result).toBe("Cuvée 319");
    })

    it('should handle names without year', () => {
        const name = 'Wine Name';
        const result = normaliseName(name);

        expect(result).toBe('Wine Name');
    });
});

describe('normaliseCurrency', () => {
    it('should convert currency to string with 2 decimal places', () => {
        const currency = '50';
        const result = normaliseCurrency(currency);

        expect(result).toBe('50.00');
    });

    it('should return null if currency is not a string', () => {
        const currency = 123;
        const result = normaliseCurrency(currency);

        expect(result).toBe(null);
    });

    it('should return null if currency is empty', () => {
        const currency = '';
        const result = normaliseCurrency(currency);

        expect(result).toBe(null);
    });
});

describe('parseCsv', () => {
    it('should parse CSV data into an array of objects', () => {
        const csv = 'scrap\nHeader1,Header2\nValue1,Value2';
        const result = parseCsv(csv);

        expect(result).toEqual([
            { header1: 'Value1', header2: 'Value2' }
        ]);
    });
})

describe('diffWines', () => {
    it('should return added wines that are in current but not previous', () => {
        const previous = [
            { id: 1, name: 'Existing wine' }
        ];
        const current = [
            { id: 1, name: 'Existing wine' },
            { id: 2, name: 'New wine' }
        ];

        const result = diffWines(previous, current);

        expect(result.added).toEqual([{ id: 2, name: 'New wine' }]);
        expect(result.removed).toEqual([]);
    });

    it('should return removed wines that are in previous but not current', () => {
        const previous = [
            { id: 1, name: 'Removed wine' },
            { id: 2, name: 'Remaining wine' }
        ];
        const current = [
            { id: 2, name: 'Remaining wine' }
        ];

        const result = diffWines(previous, current);

        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([{ id: 1, name: 'Removed wine' }]);
    });

    it('should return empty arrays when no changes identified', () => {
        const previous = [
            { id: 1, name: 'Existing wine' }
        ];
        const current = [
            { id: 1, name: 'Existing wine' }
        ];

        const result = diffWines(previous, current);

        expect(result).toEqual({
            added: [],
            removed: []
        });
    });
});
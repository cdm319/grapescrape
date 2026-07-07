import { describe, expect, it } from "vitest";
import { resolveRetailerId } from "@grapescrape/retailer-scraper/resolveRetailerId.js";

describe('resolveRetailerId', () => {
    it('uses the retailer ID from the event payload', () => {
        expect(resolveRetailerId({ retailerId: 'tws' }, {})).toBe('tws');
    });

    it('prefers the event retailer ID over the environment fallback', () => {
        expect(resolveRetailerId({ retailerId: 'tws' }, { RETAILER_ID: 'ignored' })).toBe('tws');
    });

    it('uses RETAILER_ID from the environment when the event does not provide one', () => {
        expect(resolveRetailerId({}, { RETAILER_ID: 'tws' })).toBe('tws');
    });

    it('falls back to tws when the event and environment are empty', () => {
        expect(resolveRetailerId({}, {})).toBe('tws');
    });

    it('ignores blank event and environment values', () => {
        expect(resolveRetailerId({ retailerId: '   ' }, { RETAILER_ID: '' })).toBe('tws');
    });

    it('rejects unsupported retailer IDs clearly', () => {
        expect(() => resolveRetailerId({ retailerId: 'other-retailer' }, {}))
            .toThrow('Unsupported retailer: other-retailer');
    });
});

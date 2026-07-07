import { describe, expect, it } from 'vitest';
import { buildRetailerURLs } from '@grapescrape/retailer-scraper/retailers/retailerUrls.js';

describe('buildRetailerURLs', () => {
    it('returns configured URLs for a supported retailer', () => {
        const urls = buildRetailerURLs('tws');

        expect(urls.length).toBeGreaterThan(0);
        expect(urls.every(url => url.startsWith('https://www.thewinesociety.com/CustomFileDownload/DownloadCsv')))
            .toBe(true);
    });

    it('throws clearly for unsupported retailers', () => {
        expect(() => buildRetailerURLs('unknown')).toThrow('Unsupported retailer: unknown');
    });
});

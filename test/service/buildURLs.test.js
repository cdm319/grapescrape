import { describe, expect, it } from 'vitest';
import { buildURLs } from '../../src/service/buildURLs.js';
import {
    DEFAULT_MIN_PRICE,
    DEFAULT_PRODUCT_TYPE,
    DEFAULT_STOCK_STATUS,
    DEFAULT_UNITS,
    REGION_CONTENT_IDS,
} from '../../src/config.js';

const decodeParameters = url => {
    const parsedUrl = new URL(url);

    return {
        contentId: parsedUrl.searchParams.get('contentId'),
        parameters: JSON.parse(parsedUrl.searchParams.get('parameters')),
    };
};

describe('buildURLs', () => {
    it('builds the expected number of Wine Society CSV URLs', () => {
        expect(buildURLs()).toHaveLength(18);
    });

    it('builds Bordeaux URL parameters with configured defaults', () => {
        const [url] = buildURLs();
        const { contentId, parameters } = decodeParameters(url);

        expect(url).toContain('contentId=');
        expect(contentId).toBe(REGION_CONTENT_IDS.bordeaux);
        expect(parameters).toEqual({
            Unit: DEFAULT_UNITS,
            VintageFrom: 2005,
            VintageTo: 2005,
            Grape: '',
            Region: '',
            ProductType: DEFAULT_PRODUCT_TYPE,
            PriceMinimum: DEFAULT_MIN_PRICE,
            Status: DEFAULT_STOCK_STATUS,
        });
    });

    it('builds California URL parameters with grape and subregion filters', () => {
        const californiaUrl = buildURLs()[5];
        const { contentId, parameters } = decodeParameters(californiaUrl);

        expect(contentId).toBe(REGION_CONTENT_IDS.usa);
        expect(parameters).toMatchObject({
            VintageFrom: 2000,
            VintageTo: 2025,
            Grape: '12958,12907',
            Region: '14896',
        });
    });
});

import { BASE_URL, DEFAULT_UNITS, DEFAULT_PRODUCT_TYPE, DEFAULT_MIN_PRICE, DEFAULT_STOCK_STATUS, REGION_CONTENT_IDS } from '../config.js';

const buildURL = (region, vintageFrom, vintageTo, grape = '', subregion = '') => {
    const contentId = REGION_CONTENT_IDS[region.toLowerCase().trim()];

    if (!contentId) throw new Error(`Invalid region: ${region}`);

    const params = encodeURIComponent(JSON.stringify({
        Unit: DEFAULT_UNITS,
        VintageFrom: vintageFrom,
        VintageTo: vintageTo,
        Grape: grape,
        Region: subregion,
        ProductType: DEFAULT_PRODUCT_TYPE,
        PriceMinimum: DEFAULT_MIN_PRICE,
        Status: DEFAULT_STOCK_STATUS
    }));

    return `${BASE_URL}?contentId=${contentId}&parameters=${params}`;
};

export const buildURLs = () => [
    //Bordeaux - 2005, 2009, 2010, 2015, 2016, 2018, 2019, 2020, 2022
    buildURL('bordeaux', 2005, 2005),
    buildURL('bordeaux', 2009, 2010),
    buildURL('bordeaux', 2015, 2016),
    buildURL('bordeaux', 2018, 2020),
    buildURL('bordeaux', 2022, 2022),

    // California - any vintage
    buildURL('usa', 2000, 2025, '12920,12958,14291,12907,13532', '14896'),

    // South Africa - 2015, 2017, 2020, 2021, 2022
    buildURL('sa', 2015, 2015, '12920,12958,14291,12907,13532'),
    buildURL('sa', 2017, 2017, '12920,12958,14291,12907,13532'),
    buildURL('sa', 2020, 2022, '12920,12958,14291,12907,13532'),

    // New Zealand - 2015, 2016, 2019, 2020, 2021
    buildURL('nz', 2015, 2016, '12920,12958,14291,12907,13532'),
    buildURL('nz', 2019, 2021, '12920,12958,14291,12907,13532'),

    // Rioja - 2010, 2011, 2015, 2016, 2019, 2021, 2022
    buildURL('rioja', 2010, 2011),
    buildURL('rioja', 2015, 2016),
    buildURL('rioja', 2019, 2019),
    buildURL('rioja', 2021, 2022),

    // Ribera del Duero - 2010, 2011, 2015, 2016, 2018, 2019, 2020, 2021, 2022
    buildURL('ribera', 2010, 2011),
    buildURL('ribera', 2015, 2016),
    buildURL('ribera', 2018, 2022),

    // Tuscany - 2010, 2015, 2016, 2019, 2021, 2022
    buildURL('tuscany', 2010, 2010),
    buildURL('tuscany', 2015, 2016),
    buildURL('tuscany', 2019, 2019),
    buildURL('tuscany', 2021, 2022)
];
/**
 *
 * @returns array [ string ] of The Wine Society URLs for given params
 */
export const buildTWSUrls = () => [
    //Bordeaux - 2005, 2009, 2010, 2015, 2016, 2018, 2019, 2020, 2022
    buildURL({ region: 'bordeaux', vintageFrom: 2005, vintageTo: 2005 }),
    buildURL({ region: 'bordeaux', vintageFrom: 2009, vintageTo: 2010 }),
    buildURL({ region: 'bordeaux', vintageFrom: 2015, vintageTo: 2016 }),
    buildURL({ region: 'bordeaux', vintageFrom: 2018, vintageTo: 2020 }),
    buildURL({ region: 'bordeaux', vintageFrom: 2022, vintageTo: 2022 }),

    // California - any vintage
    buildURL({ region: 'usa', vintageFrom: 2000, vintageTo: 2025, grape: '12920,12958,14291,12907,13532', subregion: '14896' }),

    // South Africa - 2015, 2017, 2020, 2021, 2022
    buildURL({ region: 'sa', vintageFrom: 2015, vintageTo: 2015, grape: '12920,12958,14291,12907,13532' }),
    buildURL({ region: 'sa', vintageFrom: 2017, vintageTo: 2017, grape: '12920,12958,14291,12907,13532' }),
    buildURL({ region: 'sa', vintageFrom: 2020, vintageTo: 2022, grape: '12920,12958,14291,12907,13532' }),

    // New Zealand - 2015, 2016, 2019, 2020, 2021
    buildURL({ region: 'nz', vintageFrom: 2015, vintageTo: 2016, grape: '12920,12958,14291,12907,13532' }),
    buildURL({ region: 'nz', vintageFrom: 2019, vintageTo: 2021, grape: '12920,12958,14291,12907,13532' }),

    // Rioja - 2010, 2011, 2015, 2016, 2019, 2021, 2022
    buildURL({ region: 'rioja', vintageFrom: 2010, vintageTo: 2011 }),
    buildURL({ region: 'rioja', vintageFrom: 2015, vintageTo: 2016 }),
    buildURL({ region: 'rioja', vintageFrom: 2019, vintageTo: 2019 }),
    buildURL({ region: 'rioja', vintageFrom: 2021, vintageTo: 2022 }),

    // Ribera del Duero - 2010, 2011, 2015, 2016, 2018, 2019, 2020, 2021, 2022
    buildURL({ region: 'ribera', vintageFrom: 2010, vintageTo: 2011 }),
    buildURL({ region: 'ribera', vintageFrom: 2015, vintageTo: 2016 }),
    buildURL({ region: 'ribera', vintageFrom: 2018, vintageTo: 2022 }),

    // Tuscany - 2010, 2015, 2016, 2019, 2021, 2022
    buildURL({ region: 'tuscany', vintageFrom: 2010, vintageTo: 2010 }),
    buildURL({ region: 'tuscany', vintageFrom: 2015, vintageTo: 2016 }),
    buildURL({ region: 'tuscany', vintageFrom: 2019, vintageTo: 2019 }),
    buildURL({ region: 'tuscany', vintageFrom: 2021, vintageTo: 2022 })
];

/**
 * Builds a valid Wine Society CSV URL for given params.
 *
 * @param params
 * @returns string - url
 */
const buildURL = params => {
    const { region, vintageFrom, vintageTo, grape = '', subregion = '' } = params;

    const contentId = REGION_CONTENT_IDS[region.toLowerCase().trim()];

    const queryStringParams = encodeURIComponent(JSON.stringify({
        Unit: DEFAULT_UNITS,
        VintageFrom: vintageFrom,
        VintageTo: vintageTo,
        Grape: grape,
        Region: subregion,
        ProductType: DEFAULT_PRODUCT_TYPE,
        PriceMinimum: DEFAULT_MIN_PRICE,
        Status: DEFAULT_STOCK_STATUS
    }));

    return `${ BASE_URL }?contentId=${ contentId }&parameters=${ queryStringParams }`;
};

// map of regions to Wine Society content IDs
const REGION_CONTENT_IDS = {
    bordeaux: '1073742856',
    usa: '1073742871',
    rioja: '1073742747',
    ribera: '1073742748',
    tuscany: '1073742741',
    sa: '1073742739',
    nz: '1073742858'
};

const BASE_URL = 'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv';
const DEFAULT_UNITS = '14156,14157,147166'; // bottles and half-bottles
const DEFAULT_PRODUCT_TYPE = '17045'; // red wine
const DEFAULT_MIN_PRICE = 15.0;
const DEFAULT_STOCK_STATUS = '0,2'; // in stock, low stock
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';

const REGION_CONTENT_IDS = {
    bordeaux: '1073742856',
    usa:      '1073742871',
    rioja:    '1073742747',
    ribera:   '1073742748',
    tuscany:  '1073742741'
};

const BASE_URL = 'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv';
const DEFAULT_UNITS = '14156,14157,147166'; // bottles and half-bottles
const DEFAULT_PRODUCT_TYPE = '17045'; // red wine
const DEFAULT_MIN_PRICE = 15.0;
const DEFAULT_STOCK_STATUS = '0,2' // in stock, low stock

const stripFirstLine = text => text.slice(text.indexOf('\n') + 1);
const normaliseName = text => text.replace(/[\s,]*\b(19|20)\d{2}\s*$/, '');
const normaliseCurrency = text => {
    if (!text) return null;

    return parseFloat(text.split(' ')[0].replace(/[^\d.]/g, '')).toFixed(2);
}

const buildURL = (region, vintageFrom, vintageTo, grape = '', subregion = '') => {
    const contentId = REGION_CONTENT_IDS[region];

    const params = encodeURIComponent(JSON.stringify({
        'Unit': DEFAULT_UNITS,
        'VintageFrom': vintageFrom,
        'VintageTo': vintageTo,
        'Grape': grape,
        'Region': subregion,
        'ProductType': DEFAULT_PRODUCT_TYPE,
        'PriceMinimum': DEFAULT_MIN_PRICE,
        'Status': DEFAULT_STOCK_STATUS
    }));

    return `${BASE_URL}?contentId=${contentId}&parameters=${params}`;
};

const fetchCsv = async (url) => {
    if (!url) throw new Error('Invalid input');

    const response = await fetch(url);

    if (!response.ok) throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);

    const csv = await response.text();
    const cleanedCsv = stripFirstLine(csv);

    const records = parse(cleanedCsv, {
        columns: header => header.map(column => column.trim().toLowerCase().replace(/\s+/g, '_')),
        skip_empty_lines: true,
        trim: true
    });

    return records.map(w => ({
        id: w.product_code,
        region: w.origin,
        vintage: w.vintage,
        name: normaliseName(w.product_title),
        price: normaliseCurrency(w.price)
    }));
};

const main = async () => {
    try {
        const urls = [
            //Bordeaux - 2005, 2009, 2010, 2015, 2016, 2018, 2019, 2020, 2022
            buildURL('bordeaux', 2005, 2005),
            buildURL('bordeaux', 2009, 2010),
            buildURL('bordeaux', 2015, 2016),
            buildURL('bordeaux', 2018, 2020),
            buildURL('bordeaux', 2022, 2022),
            // California - any vintage
            buildURL('usa', 2000, 2025, '12958,12907', '14896'),
            // Rioja - 2010, 2011, 2015, 2016, 2019, 2021
            buildURL('rioja', 2010, 2011),
            buildURL('rioja', 2015, 2016),
            buildURL('rioja', 2019, 2019),
            buildURL('rioja', 2021, 2021),
            // Ribera del Duero - 2010, 2011, 2015, 2016, 2019, 2021
            buildURL('ribera', 2010, 2011),
            buildURL('ribera', 2015, 2016),
            buildURL('ribera', 2019, 2019),
            buildURL('ribera', 2021, 2021),
            // Tuscany - 2010, 2015, 2016, 2019, 2021
            buildURL('tuscany', 2010, 2010),
            buildURL('tuscany', 2015, 2016),
            buildURL('tuscany', 2019, 2019),
            buildURL('tuscany', 2021, 2021)
        ];

        const results = (await Promise.all(urls.map(fetchCsv))).flat();

        if (results.length === 0) {
            console.log('No results found.');
            return;
        }

        results.sort((a, b) => a.price - b.price);
        console.table(results);
        // results.forEach(result => {
        //     console.log(`${result.product_code}: ${result.product_title} - £${result.price}`);
        // });
        console.log(`Number of results: ${results.length}`);
    } catch (e) {
        console.error('Error:', e.message);
    }
};

await main();

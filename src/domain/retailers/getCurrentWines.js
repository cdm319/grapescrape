import { normaliseCurrency, normaliseName, normaliseVintage } from "../wine/normalisers.js";
import { buildRetailerURLs } from "./retailerUrls.js";
import { parse } from "csv-parse/sync";

/**
 * Fetches wine data for a given retailer from multiple URLs.
 *
 * @param retailerId
 * @returns array [{ id: string, region: string, name: string, vintage: number, price: string, grape: string, alcohol: string, description: string }]
 */
export const getCurrentWines = async retailerId => {
    const urls = buildRetailerURLs(retailerId);

    return (await Promise.all(urls.map(fetchCsv))).flat();
}

/**
 * Fetches wine data in CSV format from a given URL.
 *
 * @param url
 * @returns array [{ id: string, region: string, name: string, vintage: number, price: string, grape: string, alcohol: string, description: string }]
 */
const fetchCsv = async url => {
    if (!url) throw new Error('Invalid URL');

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch retailer data: ${ response.status } ${ response.statusText }`);

    const csv = await response.text();
    const records = parseCsv(csv);

    return records.map(w => ({
        id: w.product_code,
        region: w.origin,
        name: normaliseName(w.product_title),
        vintage: normaliseVintage(w.vintage),
        price: normaliseCurrency(w.price),
        grape: w.grape,
        alcohol: w.alcohol,
        description: w.description
    }));
};

/**
 * Parses a CSV string into an array of objects.
 *
 * @param csv
 * @returns array - array of parsed CSV records
 */
const parseCsv = csv => {
    const cleanedCsv = stripFirstLine(csv);

    return parse(cleanedCsv, {
        columns: headers => headers.map(normaliseHeader),
        skip_empty_lines: true,
        trim: true
    });
}

const stripFirstLine = text => text.slice(text.indexOf('\n') + 1);

const normaliseHeader = header => header.trim().toLowerCase().replace(/\s+/g, '_');
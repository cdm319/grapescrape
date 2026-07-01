import { parse } from "csv-parse/sync";
import { normaliseCurrency, normaliseName, normaliseVintage } from "@grapescrape/domain/wine/normalisers.js";
import { createSourceHash } from "@grapescrape/domain/wine/createSourceHash.js";
import { buildRetailerURLs } from "./retailers/retailerUrls.js";

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

    return records.map(toWine);
};

const toWine = record => {
    const wine = {
        id: record.product_code,
        region: record.origin,
        name: normaliseName(record.product_title),
        vintage: normaliseVintage(record.vintage),
        price: normaliseCurrency(record.price),
        grape: record.grape,
        alcohol: record.alcohol,
        description: record.description
    };

    return {
        ...wine,
        sourceHash: createSourceHash(wine)
    };
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
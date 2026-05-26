import { parseCsv, normaliseName, normaliseCurrency } from "../utils.js";
import { buildURLs } from "./buildURLs.js";

export const fetchCsv = async url => {
    if (!url) throw new Error('Invalid URL');

    const response = await fetch(url);

    if (!response.ok) throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);

    const csv = await response.text();
    const records = parseCsv(csv);

    return records.map(w => ({
        id: w.product_code,
        region: w.origin,
        vintage: w.vintage,
        name: normaliseName(w.product_title),
        price: normaliseCurrency(w.price)
    }));
};

export const getCurrentWines = async () => {
    const urls = buildURLs();
    return (await Promise.all(urls.map(fetchCsv))).flat();
};
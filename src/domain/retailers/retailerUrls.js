import { buildTWSUrls } from "./tws.js";

/**
 * Calls the appropriate URL builder for a given retailer.
 *
 * @param retailerId
 * @returns array [ string ] of URLs to fetch
 */
export const buildRetailerURLs = retailerId => retailerURLBuilders[retailerId];

// function map of retailer IDs to URL builders
const retailerURLBuilders = {
    'tws': buildTWSUrls
};
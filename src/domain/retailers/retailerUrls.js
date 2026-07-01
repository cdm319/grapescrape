import { buildTWSUrls } from "./tws.js";

/**
 * Calls the appropriate URL builder for a given retailer.
 *
 * @param retailerId
 * @returns array [ string ] of URLs to fetch
 */
export const buildRetailerURLs = retailerId => {
    const buildUrls = retailerURLBuilders[retailerId];

    if (!buildUrls) throw new Error(`Unsupported retailer: ${ retailerId }`);

    return buildUrls();
}

// function map of retailer IDs to URL builders
const retailerURLBuilders = {
    'tws': buildTWSUrls
};
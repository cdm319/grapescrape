const DEFAULT_RETAILER_ID = 'tws';
const SUPPORTED_RETAILER_IDS = new Set([DEFAULT_RETAILER_ID]);

/**
 * Resolves the retailer ID for a scraper invocation.
 *
 * Event payload values take precedence over environment configuration. Empty
 * values are ignored so the handler preserves the existing TWS-only behaviour.
 *
 * @param event
 * @param env
 * @returns string
 */
export const resolveRetailerId = (event, env = process.env) => {
    const retailerId = normaliseRetailerId(event?.retailerId)
        ?? normaliseRetailerId(env?.RETAILER_ID)
        ?? DEFAULT_RETAILER_ID;

    if (!SUPPORTED_RETAILER_IDS.has(retailerId)) {
        throw new Error(`Unsupported retailer: ${ retailerId }`);
    }

    return retailerId;
};

const normaliseRetailerId = value => {
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();

    return trimmed.length ? trimmed : undefined;
};

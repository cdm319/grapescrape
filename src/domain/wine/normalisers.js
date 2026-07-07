/**
 * Removes vintage from the wine name.
 *
 * @param name
 * @returns string - the wine name without vintage
 */
export const normaliseName = name => name.replace(/[\s,]*\b(19|20)\d{2}\s*$/, '');

/**
 * Converts a vintage string to a number, or null if the conversion fails.
 *
 * @param vintageText
 * @returns number|null - the parsed vintage, or null if the conversion fails
 */
export const normaliseVintage = vintageText => {
    const vintage = parseInt(vintageText, 10);

    return isNaN(vintage) ? null : vintage;
};

/**
 * Normalises a currency string to two decimal places, or null if the conversion fails.
 *
 * @param currency
 * @returns string|null - the parsed currency, or null if the conversion fails
 */
export const normaliseCurrency = currency => {
    if (!currency || typeof currency !== 'string') return null;

    return parseFloat(currency.split(' ')[0].replace(/[^\d.]/g, '')).toFixed(2);
};
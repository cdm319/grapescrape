import { parse } from 'csv-parse/sync';

export const stripFirstLine = text => text.slice(text.indexOf('\n') + 1);

export const normaliseHeader = header => header.trim().toLowerCase().replace(/\s+/g, '_');

export const normaliseName = text => text.replace(/[\s,]*\b(19|20)\d{2}\s*$/, '');

export const normaliseVintage = text => {
    const vintage = parseInt(text, 10);

    return isNaN(vintage) ? null : vintage;
};

export const normaliseCurrency = text => {
    if (!text || typeof text !== 'string') return null;

    return parseFloat(text.split(' ')[0].replace(/[^\d.]/g, '')).toFixed(2);
}

export const parseCsv = csv => {
    const cleanedCsv = stripFirstLine(csv);

    return parse(cleanedCsv, {
        columns: headers => headers.map(normaliseHeader),
        skip_empty_lines: true,
        trim: true
    });
}

export const diffWines = (previous, current) => {
    const previousById = new Map(previous.map(wine => [wine.id, wine]));
    const currentById = new Map(current.map(wine => [wine.id, wine]));

    return {
        added: current.filter(wine => !previousById.has(wine.id)),
        removed: previous.filter(wine => !currentById.has(wine.id)),
    };
};
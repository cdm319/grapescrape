import {
    CatalogueApiError,
    invalidCursor,
    validationError,
} from './catalogueErrors.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const FIT_RANKS = {
    poor: 1,
    maybe: 2,
    good: 3,
    strong: 4,
};

const CONFIDENCE_RANKS = {
    low: 1,
    medium: 2,
    medium_high: 3,
    high: 4,
};

const FRESHNESS_STATUSES = new Set([
    'current',
    'palate_profile_changed',
    'source_changed',
    'palate_profile_and_source_changed',
    'unassessed',
]);

const SORTS = new Set([
    'first_seen',
    'price',
    'name',
    'fit',
    'confidence',
]);

const ALLOWED_QUERY_PARAMETERS = new Set([
    'q',
    'retailerId',
    'fit',
    'confidence',
    'freshness',
    'sort',
    'direction',
    'limit',
    'cursor',
]);

export const parseCatalogueQuery = queryStringParameters => {
    const parameters = queryStringParameters ?? {};
    const unknownParameters = Object.keys(parameters)
        .filter(parameter => !ALLOWED_QUERY_PARAMETERS.has(parameter));

    if (unknownParameters.length > 0) {
        throw new CatalogueApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The request is invalid.',
            details: unknownParameters.sort().map(parameter => ({
                field: `query.${ parameter }`,
                reason: 'is not supported',
            })),
        });
    }

    const q = parseSearchQuery(parameters.q);
    const retailerId = parseOptionalNonEmptyString(parameters.retailerId, 'retailerId');
    const fit = parseEnumList(parameters.fit, 'fit', new Set(Object.keys(FIT_RANKS)));
    const confidence = parseEnumList(
        parameters.confidence,
        'confidence',
        new Set(Object.keys(CONFIDENCE_RANKS)),
    );
    const freshness = parseEnumList(
        parameters.freshness,
        'freshness',
        FRESHNESS_STATUSES,
    );
    const sort = parameters.sort ?? 'name';

    if (!SORTS.has(sort)) {
        throw validationError('sort', 'must be first_seen, price, name, fit or confidence');
    }

    const direction = parameters.direction ?? (sort === 'first_seen' ? 'desc' : 'asc');

    if (direction !== 'asc' && direction !== 'desc') {
        throw validationError('direction', 'must be asc or desc');
    }

    const limit = parseLimit(parameters.limit);
    const queryKey = JSON.stringify({
        q: q ? normaliseSearchText(q) : null,
        retailerId: retailerId ?? null,
        fit: fit ? [...fit].sort() : null,
        confidence: confidence ? [...confidence].sort() : null,
        freshness: freshness ? [...freshness].sort() : null,
        sort,
        direction,
    });

    return {
        q,
        retailerId,
        fit,
        confidence,
        freshness,
        sort,
        direction,
        limit,
        cursor: parameters.cursor !== undefined
            ? parseCursor(parameters.cursor, queryKey)
            : null,
        queryKey,
    };
};

export const filterAndPaginateCatalogueWines = (items, query) => {
    const filteredItems = items.filter(item => matchesCatalogueQuery(item, query));
    const sortedItems = filteredItems.sort(createCatalogueComparator(query));

    return paginateCatalogueWines(sortedItems, query);
};

const parseSearchQuery = value => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw validationError('q', 'must be a string between 1 and 120 characters');
    }

    const q = value.trim();

    if (q.length < 1 || q.length > 120) {
        throw validationError('q', 'must be between 1 and 120 characters');
    }

    return q;
};

const parseOptionalNonEmptyString = (value, field) => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string' || value.length === 0) {
        throw validationError(field, 'must be a non-empty string');
    }

    return value;
};

const parseEnumList = (value, field, allowedValues) => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string' || value.length === 0) {
        throw validationError(field, 'must contain one or more supported values');
    }

    const values = value.split(',').map(item => item.trim());

    if (values.some(item => !allowedValues.has(item))) {
        throw validationError(field, 'contains an unsupported value');
    }

    return new Set(values);
};

const parseLimit = value => {
    if (value === undefined) {
        return DEFAULT_LIMIT;
    }

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw validationError('limit', 'must be an integer between 1 and 100');
    }

    const limit = Number(value);

    if (limit < 1 || limit > MAX_LIMIT) {
        throw validationError('limit', 'must be between 1 and 100');
    }

    return limit;
};

const parseCursor = (value, queryKey) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw invalidCursor();
    }

    try {
        const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

        if (
            cursor?.version !== 1
            || cursor.queryKey !== queryKey
            || typeof cursor.lastSourceKey !== 'string'
            || !Object.hasOwn(cursor, 'lastSortValue')
        ) {
            throw invalidCursor();
        }

        return cursor;
    } catch (error) {
        if (error instanceof CatalogueApiError) {
            throw error;
        }

        throw invalidCursor();
    }
};

const matchesCatalogueQuery = (item, query) => {
    if (query.q) {
        const q = normaliseSearchText(query.q);
        const identityText = [
            item.name,
            item.vintage,
            item.retailerId,
            item.retailerLabel,
            item.region,
        ].map(normaliseSearchText).join(' ');

        if (!identityText.includes(q)) {
            return false;
        }
    }

    if (query.retailerId && item.retailerId !== query.retailerId) {
        return false;
    }

    if (query.freshness && !query.freshness.has(item.freshness.status)) {
        return false;
    }

    const explicitlyIncludesUnassessed = query.freshness?.has('unassessed') === true;

    if (
        query.fit
        && !(
            item.latestAssessment
                ? query.fit.has(item.latestAssessment.fit)
                : explicitlyIncludesUnassessed
        )
    ) {
        return false;
    }

    if (
        query.confidence
        && !(
            item.latestAssessment
                ? query.confidence.has(item.latestAssessment.confidence)
                : explicitlyIncludesUnassessed
        )
    ) {
        return false;
    }

    return true;
};

const createCatalogueComparator = query => (left, right) => {
    const leftValue = getSortValue(left, query.sort);
    const rightValue = getSortValue(right, query.sort);

    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;

    const valueComparison = compareSortValues(leftValue, rightValue);

    if (valueComparison !== 0) {
        return query.direction === 'desc' ? -valueComparison : valueComparison;
    }

    return compareStrings(left.sourceKey, right.sourceKey);
};

const compareSortValues = (left, right) => {
    if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
    }

    return compareStrings(String(left), String(right));
};

const compareStrings = (left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
};

const getSortValue = (item, sort) => {
    if (sort === 'first_seen') return item.firstSeenAt;
    if (sort === 'price') return Number(item.currentPrice.amount);
    if (sort === 'fit') return item.latestAssessment
        ? FIT_RANKS[item.latestAssessment.fit] ?? null
        : null;
    if (sort === 'confidence') return item.latestAssessment
        ? CONFIDENCE_RANKS[item.latestAssessment.confidence] ?? null
        : null;

    return normaliseSearchText(item.name);
};

const paginateCatalogueWines = (items, query) => {
    let startIndex = 0;

    if (query.cursor) {
        const cursorIndex = items.findIndex(item =>
            item.sourceKey === query.cursor.lastSourceKey
            && getSortValue(item, query.sort) === query.cursor.lastSortValue
        );

        if (cursorIndex === -1) {
            throw invalidCursor();
        }

        startIndex = cursorIndex + 1;
    }

    const pageItems = items.slice(startIndex, startIndex + query.limit);
    const hasNextPage = startIndex + query.limit < items.length;
    const lastItem = pageItems.at(-1);

    return {
        items: pageItems,
        nextCursor: hasNextPage
            ? Buffer.from(JSON.stringify({
                version: 1,
                queryKey: query.queryKey,
                lastSourceKey: lastItem.sourceKey,
                lastSortValue: getSortValue(lastItem, query.sort),
            })).toString('base64url')
            : null,
    };
};

const normaliseSearchText = value => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

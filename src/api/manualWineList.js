import {
    isManualWineId,
    normaliseManualWineName,
} from '@grapescrape/domain/wine/manualWine';

const LIST_FIELDS = ['q', 'sort', 'direction', 'limit', 'cursor'];
const LIST_SORTS = ['created', 'updated', 'name'];
const LIST_DIRECTIONS = ['asc', 'desc'];
const DEFAULT_LIMIT = 25;

export const parseManualWineListQuery = queryStringParameters => {
    const query = queryStringParameters ?? {};
    const errors = [];
    let validationFailed = false;

    if (
        query === null
        || typeof query !== 'object'
        || Array.isArray(query)
    ) {
        return {
            valid: false,
            validationFailed: false,
            errors: [{
                field: 'query',
                reason: 'must be an object',
            }],
        };
    }

    for (const field of Object.keys(query)) {
        if (!LIST_FIELDS.includes(field)) {
            errors.push({
                field,
                reason: 'is not allowed',
            });
        }
    }

    const q = query.q;
    if (
        q !== undefined
        && (
            typeof q !== 'string'
            || q.trim() !== q
            || Array.from(q).length < 1
            || Array.from(q).length > 120
        )
    ) {
        validationFailed = true;
        errors.push({
            field: 'q',
            reason: 'must be a trimmed string between 1 and 120 characters',
        });
    }

    const sort = query.sort ?? 'updated';
    if (!LIST_SORTS.includes(sort)) {
        errors.push({
            field: 'sort',
            reason: 'must be created, updated, or name',
        });
    }

    const direction = query.direction ?? 'desc';
    if (!LIST_DIRECTIONS.includes(direction)) {
        errors.push({
            field: 'direction',
            reason: 'must be asc or desc',
        });
    }

    const limit = query.limit === undefined
        ? DEFAULT_LIMIT
        : parseLimit(query.limit);
    if (limit === undefined) {
        errors.push({
            field: 'limit',
            reason: 'must be an integer from 1 through 100',
        });
    }

    return {
        valid: errors.length === 0,
        validationFailed: validationFailed && errors.length === 1,
        errors,
        value: {
            q,
            normalizedQ: q === undefined
                ? undefined
                : normaliseManualWineName(q),
            sort,
            direction,
            limit,
            cursor: query.cursor,
        },
    };
};

export const paginateManualWines = (manualWines, query) => {
    const filtered = query.q
        ? manualWines.filter(manualWine =>
            `${ normaliseManualWineName(manualWine.name) } ${ manualWine.vintage.toLowerCase() }`
                .includes(query.normalizedQ))
        : manualWines;
    const sorted = [...filtered].sort((left, right) =>
        compareManualWines(left, right, query));
    const cursor = query.cursor
        ? parseCursor(query.cursor, query)
        : undefined;
    const startIndex = cursor
        ? findPageStart(sorted, cursor, query)
        : 0;
    const items = sorted.slice(startIndex, startIndex + query.limit);
    const hasMore = startIndex + items.length < sorted.length;

    return {
        items,
        nextCursor: hasMore
            ? createCursor(items.at(-1), query)
            : null,
    };
};

const parseLimit = value => {
    if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) {
        return undefined;
    }

    const parsed = Number(value);
    return parsed >= 1 && parsed <= 100
        ? parsed
        : undefined;
};

const compareManualWines = (left, right, query) => {
    const leftValue = sortValue(left, query.sort);
    const rightValue = sortValue(right, query.sort);
    const valueComparison = compareStrings(leftValue, rightValue);
    const idComparison = compareStrings(left.id, right.id);
    const comparison = valueComparison || idComparison;

    return query.direction === 'asc'
        ? comparison
        : -comparison;
};

const sortValue = (manualWine, sort) => {
    if (sort === 'created') return manualWine.createdAt;
    if (sort === 'name') return normaliseManualWineName(manualWine.name);
    return manualWine.updatedAt;
};

const compareStrings = (left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
};

const createCursor = (manualWine, query) => Buffer.from(JSON.stringify({
    version: 1,
    q: query.normalizedQ ?? null,
    sort: query.sort,
    direction: query.direction,
    lastId: manualWine.id,
    lastValue: sortValue(manualWine, query.sort),
})).toString('base64url');

const parseCursor = (cursor, query) => {
    try {
        if (
            typeof cursor !== 'string'
            || cursor.length < 1
            || cursor.length > 2_048
            || !/^[A-Za-z0-9_-]+$/.test(cursor)
        ) {
            throw new Error('invalid cursor encoding');
        }

        const parsed = JSON.parse(
            Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        const fields = [
            'version',
            'q',
            'sort',
            'direction',
            'lastId',
            'lastValue',
        ];

        if (
            !parsed
            || typeof parsed !== 'object'
            || Array.isArray(parsed)
            || Object.keys(parsed).length !== fields.length
            || fields.some(field => !Object.hasOwn(parsed, field))
            || parsed.version !== 1
            || parsed.q !== (query.normalizedQ ?? null)
            || parsed.sort !== query.sort
            || parsed.direction !== query.direction
            || !isManualWineId(parsed.lastId)
            || typeof parsed.lastValue !== 'string'
        ) {
            throw new Error('invalid cursor');
        }

        return parsed;
    } catch {
        const error = new Error('Invalid cursor');
        error.name = 'InvalidCursorError';
        throw error;
    }
};

const findPageStart = (manualWines, cursor, query) => {
    const index = manualWines.findIndex(manualWine =>
        compareManualWineToCursor(manualWine, cursor, query) > 0);

    return index >= 0
        ? index
        : manualWines.length;
};

const compareManualWineToCursor = (manualWine, cursor, query) => {
    const valueComparison = compareStrings(
        sortValue(manualWine, query.sort),
        cursor.lastValue,
    );
    const idComparison = compareStrings(manualWine.id, cursor.lastId);
    const comparison = valueComparison || idComparison;

    return query.direction === 'asc'
        ? comparison
        : -comparison;
};

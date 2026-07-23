import { createHash } from 'node:crypto';
import {
    AssessmentHistoryApiError,
    invalidCursor,
    validationFailed,
} from './assessmentHistoryApiError.js';

const FIT_VALUES = ['strong', 'good', 'maybe', 'poor'];
const CONFIDENCE_VALUES = ['high', 'medium_high', 'medium', 'low'];
const AVAILABILITY_VALUES = [
    'current_retailer',
    'removed_retailer',
    'active_manual',
    'deleted_manual',
];
const FRESHNESS_VALUES = [
    'current',
    'palate_profile_changed',
    'source_changed',
    'palate_profile_and_source_changed',
    'unassessed',
];
const LIST_SORTS = ['last_assessed', 'name', 'fit', 'confidence'];
const DIRECTIONS = ['asc', 'desc'];
const FIT_RANK = new Map(FIT_VALUES.map((value, index) => [value, FIT_VALUES.length - index]));
const CONFIDENCE_RANK = new Map(
    CONFIDENCE_VALUES.map((value, index) => [value, CONFIDENCE_VALUES.length - index])
);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const parseAssessedWineQuery = query => {
    rejectUnknownQueryParameters(query, [
        'q',
        'sourceType',
        'availability',
        'fit',
        'confidence',
        'highlight',
        'freshness',
        'completedFrom',
        'completedTo',
        'sort',
        'direction',
        'limit',
        'cursor',
    ]);

    const parsed = {
        q: parseSearch(query.q),
        sourceType: parseSingleEnum(query.sourceType, ['retailer', 'manual'], 'sourceType'),
        availability: parseEnumList(query.availability, AVAILABILITY_VALUES, 'availability'),
        fit: parseEnumList(query.fit, FIT_VALUES, 'fit'),
        confidence: parseEnumList(query.confidence, CONFIDENCE_VALUES, 'confidence'),
        highlight: parseBoolean(query.highlight, 'highlight'),
        freshness: parseEnumList(query.freshness, FRESHNESS_VALUES, 'freshness'),
        completedFrom: parseTimestamp(query.completedFrom, 'completedFrom'),
        completedTo: parseTimestamp(query.completedTo, 'completedTo'),
        sort: parseSingleEnum(query.sort, LIST_SORTS, 'sort') ?? 'last_assessed',
        direction: parseSingleEnum(query.direction, DIRECTIONS, 'direction') ?? 'desc',
        limit: parseLimit(query.limit),
        cursor: query.cursor,
    };

    if (
        parsed.completedFrom !== undefined
        && parsed.completedTo !== undefined
        && parsed.completedFrom > parsed.completedTo
    ) {
        throw validationFailed(
            'completedFrom',
            'must be before or equal to completedTo'
        );
    }

    return parsed;
};

export const parseAssessmentListQuery = query => {
    rejectUnknownQueryParameters(query, ['limit', 'cursor']);

    return {
        limit: parseLimit(query.limit),
        cursor: query.cursor,
    };
};

export const paginateAssessedWineSummaries = ({ summaries, query }) => {
    const filtered = summaries.filter(summary =>
        matchesAssessedWineQuery(summary, query)
    );
    const ordered = filtered.toSorted(createAssessedWineComparator(query));
    const fingerprint = createFingerprint({
        route: 'assessed-wines',
        ...cursorBoundAssessedWineQuery(query),
    });

    return paginate({
        items: ordered,
        limit: query.limit,
        cursor: query.cursor,
        fingerprint,
        getAnchor: item => getAssessedWineAnchor(item, query.sort),
        compareToAnchor: (item, anchor) =>
            compareAssessedWineToAnchor(item, anchor, query),
        validateAnchor: anchor =>
            isValidAssessedWineAnchor(anchor, query.sort),
    });
};

export const paginateAssessmentRows = ({
    assessments,
    sourceKey,
    query,
}) => paginate({
    items: assessments.toSorted(compareAssessmentVersions),
    limit: query.limit,
    cursor: query.cursor,
    fingerprint: createFingerprint({
        route: 'assessments',
        sourceKey,
    }),
    getAnchor: getAssessmentAnchor,
    compareToAnchor: compareAssessmentToAnchor,
    validateAnchor: isValidAssessmentAnchor,
});

export const compareAssessmentVersions = (left, right) =>
    getAssessmentVersion(right) - getAssessmentVersion(left)
    || getAssessmentInputKey(right).localeCompare(getAssessmentInputKey(left));

export const getAssessmentVersion = assessment =>
    assessment.assessmentVersion ?? 1;

export const getAssessmentInputKey = assessment =>
    assessment.assessmentInputKey ?? '';

const rejectUnknownQueryParameters = (query, allowed) => {
    const unknown = Object.keys(query).filter(name => !allowed.includes(name));

    if (unknown.length > 0) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The request is invalid.',
            details: unknown.map(field => ({
                field,
                reason: 'is not supported',
            })),
        });
    }
};

const parseSearch = value => {
    if (value === undefined) return undefined;

    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120) {
        throw validationFailed('q', 'must be between 1 and 120 characters');
    }

    return normaliseSearchText(value);
};

const parseEnumList = (value, allowed, field) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length === 0) {
        throw validationFailed(field, `must contain one of: ${ allowed.join(', ') }`);
    }

    const values = value.split(',');

    if (
        values.some(item => !allowed.includes(item))
        || new Set(values).size !== values.length
    ) {
        throw validationFailed(
            field,
            `must contain unique values from: ${ allowed.join(', ') }`
        );
    }

    return values.toSorted();
};

const parseSingleEnum = (value, allowed, field) => {
    if (value === undefined) return undefined;

    if (!allowed.includes(value)) {
        throw validationFailed(field, `must be one of: ${ allowed.join(', ') }`);
    }

    return value;
};

const parseBoolean = (value, field) => {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw validationFailed(field, 'must be true or false');
};

const parseTimestamp = (value, field) => {
    if (value === undefined) return undefined;

    if (
        typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
            .test(value)
    ) {
        throw validationFailed(field, 'must be an RFC 3339 timestamp');
    }

    const timestamp = Date.parse(value);

    if (!Number.isFinite(timestamp)) {
        throw validationFailed(field, 'must be an RFC 3339 timestamp');
    }

    return timestamp;
};

const parseLimit = value => {
    if (value === undefined) return DEFAULT_LIMIT;

    if (!/^\d+$/.test(value)) {
        throw validationFailed('limit', `must be an integer from 1 to ${ MAX_LIMIT }`);
    }

    const limit = Number(value);

    if (limit < 1 || limit > MAX_LIMIT) {
        throw validationFailed('limit', `must be an integer from 1 to ${ MAX_LIMIT }`);
    }

    return limit;
};

const matchesAssessedWineQuery = (summary, query) => {
    if (query.q && !matchesIdentitySearch(summary, query.q)) return false;
    if (query.sourceType && summary.sourceType !== query.sourceType) return false;
    if (query.availability && !query.availability.includes(summary.wine.availability)) {
        return false;
    }
    if (query.fit && !query.fit.includes(summary.latestAssessment.fit)) return false;
    if (
        query.confidence
        && !query.confidence.includes(summary.latestAssessment.confidence)
    ) {
        return false;
    }
    if (
        query.highlight !== undefined
        && summary.latestAssessment.highlight !== query.highlight
    ) {
        return false;
    }
    if (query.freshness && !query.freshness.includes(summary.freshness.status)) {
        return false;
    }

    const completedAt = Date.parse(summary.lastAssessedAt);
    if (query.completedFrom !== undefined && completedAt < query.completedFrom) return false;
    if (query.completedTo !== undefined && completedAt > query.completedTo) return false;

    return true;
};

const matchesIdentitySearch = (summary, search) => {
    const values = [
        summary.wine.name,
        summary.wine.vintage,
        summary.wine.region,
        summary.wine.grape,
        summary.wine.alcohol,
    ];

    return normaliseSearchText(values.join(' ')).includes(search);
};

const createAssessedWineComparator = ({ sort, direction }) => (left, right) =>
    compareAssessedWineRows(left, right, { sort, direction });

const compareAssessedWineRows = (left, right, { sort, direction }) => {
    const primaryComparison = compareValues(
        getAssessedWineSortValue(left, sort),
        getAssessedWineSortValue(right, sort)
    );
    const directedComparison = direction === 'desc'
        ? -primaryComparison
        : primaryComparison;

    return directedComparison || left.sourceKey.localeCompare(right.sourceKey);
};

const compareAssessedWineToAnchor = (item, anchor, query) =>
    compareAssessedWineRows(
        item,
        assessedWineFromAnchor(anchor, query.sort),
        query
    );

const assessedWineFromAnchor = (anchor, sort) => {
    const item = {
        sourceKey: anchor.sourceKey,
        wine: {},
        latestAssessment: {},
    };

    if (sort === 'last_assessed') item.lastAssessedAt = anchor.primary;
    if (sort === 'name') item.wine.name = anchor.primary;
    if (sort === 'fit') item.latestAssessment.fit = fitFromRank(anchor.primary);
    if (sort === 'confidence') {
        item.latestAssessment.confidence = confidenceFromRank(anchor.primary);
    }

    return item;
};

const getAssessedWineAnchor = (item, sort) => ({
    primary: getAssessedWineSortValue(item, sort),
    sourceKey: item.sourceKey,
});

const getAssessedWineSortValue = (item, sort) => {
    if (sort === 'name') return normaliseSearchText(item.wine.name);
    if (sort === 'fit') return FIT_RANK.get(item.latestAssessment.fit) ?? 0;
    if (sort === 'confidence') {
        return CONFIDENCE_RANK.get(item.latestAssessment.confidence) ?? 0;
    }

    return item.lastAssessedAt;
};

const fitFromRank = rank =>
    [...FIT_RANK.entries()].find(([, value]) => value === rank)?.[0];

const confidenceFromRank = rank =>
    [...CONFIDENCE_RANK.entries()].find(([, value]) => value === rank)?.[0];

const compareValues = (left, right) => {
    if (left === right) return 0;
    if (left === undefined || left === null) return 1;
    if (right === undefined || right === null) return -1;

    return left < right ? -1 : 1;
};

const compareAssessmentToAnchor = (assessment, anchor) =>
    anchor.assessmentVersion - getAssessmentVersion(assessment)
    || anchor.assessmentInputKey.localeCompare(getAssessmentInputKey(assessment));

const getAssessmentAnchor = assessment => ({
    assessmentVersion: getAssessmentVersion(assessment),
    assessmentInputKey: getAssessmentInputKey(assessment),
});

const paginate = ({
    items,
    limit,
    cursor,
    fingerprint,
    getAnchor,
    compareToAnchor,
    validateAnchor,
}) => {
    let remaining = items;

    if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);

        if (
            decoded.version !== 1
            || decoded.fingerprint !== fingerprint
            || !validateAnchor(decoded.anchor)
        ) {
            throw invalidCursor();
        }

        remaining = items.filter(item => compareToAnchor(item, decoded.anchor) > 0);
    }

    const pageItems = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;

    return {
        items: pageItems,
        nextCursor: hasMore
            ? encodeCursor({
                version: 1,
                fingerprint,
                anchor: getAnchor(pageItems.at(-1)),
            })
            : null,
    };
};

const isValidAssessedWineAnchor = (anchor, sort) =>
    anchor
    && typeof anchor === 'object'
    && typeof anchor.sourceKey === 'string'
    && (
        sort === 'fit' || sort === 'confidence'
            ? Number.isInteger(anchor.primary)
            : typeof anchor.primary === 'string'
    );

const isValidAssessmentAnchor = anchor =>
    anchor
    && typeof anchor === 'object'
    && Number.isSafeInteger(anchor.assessmentVersion)
    && anchor.assessmentVersion > 0
    && typeof anchor.assessmentInputKey === 'string';

const encodeCursor = value =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const decodeCursor = cursor => {
    if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 4096) {
        throw invalidCursor();
    }

    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            throw invalidCursor();
        }

        return decoded;
    } catch (error) {
        if (error instanceof AssessmentHistoryApiError) throw error;
        throw invalidCursor();
    }
};

const createFingerprint = value =>
    createHash('sha256')
        .update(JSON.stringify(value))
        .digest('base64url');

const cursorBoundAssessedWineQuery = query => ({
    q: query.q ?? null,
    sourceType: query.sourceType ?? null,
    availability: query.availability ?? null,
    fit: query.fit ?? null,
    confidence: query.confidence ?? null,
    highlight: query.highlight ?? null,
    freshness: query.freshness ?? null,
    completedFrom: query.completedFrom ?? null,
    completedTo: query.completedTo ?? null,
    sort: query.sort,
    direction: query.direction,
});

const normaliseSearchText = value =>
    String(value ?? '')
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

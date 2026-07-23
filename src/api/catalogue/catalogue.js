import {
    CatalogueApiError,
    catalogueWineNotFound,
    invalidSourceKey,
} from './catalogueErrors.js';
import {
    filterAndPaginateCatalogueWines,
    parseCatalogueQuery,
} from './catalogueQuery.js';
import { toCatalogueWine } from './catalogueRepresentation.js';

const LIST_ROUTE = 'GET /v1/catalogue/wines';
const DETAIL_ROUTE = 'GET /v1/catalogue/wines/{sourceKey}';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const DEFAULT_RETAILER_LABELS = {
    tws: 'The Wine Society',
};

export const createCatalogueHandler = ({
    catalogueStore,
    retailerLabels = DEFAULT_RETAILER_LABELS,
} = {}) => {
    if (!catalogueStore) throw new Error('catalogueStore is required');

    return async event => {
        const requestId = event?.requestContext?.requestId ?? 'unknown';
        const userId = event?.requestContext?.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse({
                statusCode: 401,
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required.',
                requestId,
            });
        }

        try {
            rejectRequestBody(event);

            if (event?.routeKey === LIST_ROUTE) {
                return await listCatalogueWines({
                    event,
                    requestId,
                    userId,
                    catalogueStore,
                    retailerLabels,
                });
            }

            if (event?.routeKey === DETAIL_ROUTE) {
                return await getCatalogueWine({
                    event,
                    requestId,
                    userId,
                    catalogueStore,
                    retailerLabels,
                });
            }

            throw new CatalogueApiError({
                statusCode: 400,
                code: 'INVALID_REQUEST',
                message: 'The request is invalid.',
            });
        } catch (error) {
            if (error instanceof CatalogueApiError) {
                return errorResponse({
                    statusCode: error.statusCode,
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    requestId,
                });
            }

            console.error(
                `Catalogue request failed requestId=${ requestId } errorName=${ error?.name ?? 'Error' }`
            );
            return errorResponse({
                statusCode: 500,
                code: 'INTERNAL_ERROR',
                message: 'The request could not be completed.',
                requestId,
            });
        }
    };
};

const listCatalogueWines = async ({
    event,
    requestId,
    userId,
    catalogueStore,
    retailerLabels,
}) => {
    const query = parseCatalogueQuery(event.queryStringParameters);
    const supportedRetailerIds = Object.keys(retailerLabels);
    const retailerIds = query.retailerId
        ? supportedRetailerIds.filter(retailerId => retailerId === query.retailerId)
        : supportedRetailerIds;

    const [wineRows, currentPalateProfileVersion] = await Promise.all([
        catalogueStore.listCurrentWines({ retailerIds }),
        catalogueStore.getCurrentPalateProfileVersion(userId),
    ]);

    const currentRetailerWines = wineRows.filter(wine =>
        wine.isCurrent === true
        && typeof wine.sourceKey === 'string'
        && wine.sourceKey.startsWith('retailer:')
        && Object.hasOwn(retailerLabels, wine.retailerId)
    );

    const assessmentsBySourceKey = await catalogueStore.getLatestCompletedAssessments({
        userId,
        sourceKeys: currentRetailerWines.map(wine => wine.sourceKey),
    });

    const items = currentRetailerWines.map(wine => toCatalogueWine({
        wine,
        latestAssessment: assessmentsBySourceKey.get(wine.sourceKey),
        currentPalateProfileVersion,
        retailerLabel: retailerLabels[wine.retailerId],
    }));
    const page = filterAndPaginateCatalogueWines(items, query);

    return successResponse({
        statusCode: 200,
        data: {
            items: page.items,
        },
        meta: {
            requestId,
            nextCursor: page.nextCursor,
        },
    });
};

const getCatalogueWine = async ({
    event,
    requestId,
    userId,
    catalogueStore,
    retailerLabels,
}) => {
    rejectQueryParameters(event.queryStringParameters);
    const source = parseRetailerSourceKey(event?.pathParameters?.sourceKey);
    const retailerLabel = Object.hasOwn(retailerLabels, source.retailerId)
        ? retailerLabels[source.retailerId]
        : undefined;

    if (!retailerLabel) {
        throw catalogueWineNotFound();
    }

    const wine = await catalogueStore.getCurrentWine(source);

    if (!wine || wine.sourceKey !== source.sourceKey) {
        throw catalogueWineNotFound();
    }

    const [latestAssessment, currentPalateProfileVersion] = await Promise.all([
        catalogueStore.getLatestCompletedAssessment({
            userId,
            sourceKey: source.sourceKey,
        }),
        catalogueStore.getCurrentPalateProfileVersion(userId),
    ]);

    const catalogueWine = toCatalogueWine({
        wine,
        latestAssessment,
        currentPalateProfileVersion,
        retailerLabel,
    });

    return successResponse({
        statusCode: 200,
        data: {
            ...catalogueWine,
            assessmentHistory: {
                href: `/v1/assessed-wines/${ encodeURIComponent(source.sourceKey) }/assessments`,
            },
        },
        meta: {
            requestId,
        },
    });
};

const parseRetailerSourceKey = sourceKey => {
    if (typeof sourceKey !== 'string') {
        throw invalidSourceKey();
    }

    const parts = sourceKey.split(':');

    if (
        parts.length !== 3
        || parts[0] !== 'retailer'
        || !parts[1]
        || !parts[2]
    ) {
        throw invalidSourceKey();
    }

    return {
        sourceKey,
        retailerId: parts[1],
        wineId: parts[2],
    };
};

const rejectRequestBody = event => {
    if (event?.body !== undefined && event.body !== null && event.body !== '') {
        throw new CatalogueApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The request is invalid.',
            details: [{
                field: 'body',
                reason: 'is not supported',
            }],
        });
    }
};

const rejectQueryParameters = queryStringParameters => {
    const parameters = Object.keys(queryStringParameters ?? {});

    if (parameters.length > 0) {
        throw new CatalogueApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The request is invalid.',
            details: parameters.sort().map(parameter => ({
                field: `query.${ parameter }`,
                reason: 'is not supported',
            })),
        });
    }
};

const successResponse = ({ statusCode, data, meta }) => ({
    statusCode,
    headers: {
        'content-type': JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
        data,
        meta,
    }),
});

const errorResponse = ({
    statusCode,
    code,
    message,
    details,
    requestId,
}) => ({
    statusCode,
    headers: {
        'content-type': JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
        error: {
            code,
            message,
            ...(details ? { details } : {}),
        },
        meta: {
            requestId,
        },
    }),
});

import { randomUUID } from 'node:crypto';
import { isManualWineId } from '@grapescrape/domain/wine/manualWine';
import { createAssessmentVersionStore } from '@grapescrape/state/dynamodb/assessmentVersionStore';
import { createCatalogueStore } from '@grapescrape/state/dynamodb/catalogueStore';
import { documentClient } from '@grapescrape/state/dynamodb/client';
import { createManualWineStore } from '@grapescrape/state/dynamodb/manualWineStore';
import { createPalateProfileStore } from '@grapescrape/state/dynamodb/palateProfileStore';
import { createAssessmentQueue } from '@grapescrape/state/sqs/assessmentQueue';
import { sqsClient } from '@grapescrape/state/sqs/client';

const ROUTE = 'POST /v1/assessment-requests';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_SOURCE_KEYS = 25;

export const createAssessmentRequestsHandler = ({
    palateProfileStore,
    catalogueStore,
    manualWineStore,
    assessmentVersionStore,
    assessmentQueue,
    createId = randomUUID,
    now = () => new Date().toISOString(),
} = {}) => {
    if (!palateProfileStore) throw new Error('palateProfileStore is required');
    if (!catalogueStore) throw new Error('catalogueStore is required');
    if (!manualWineStore) throw new Error('manualWineStore is required');
    if (!assessmentVersionStore) throw new Error('assessmentVersionStore is required');
    if (!assessmentQueue) throw new Error('assessmentQueue is required');

    return async event => {
        const apiRequestId = event?.requestContext?.requestId ?? 'unknown';
        const userId = event?.requestContext?.authorizer?.jwt?.claims?.sub;

        if (!userId) {
            return errorResponse({
                statusCode: 401,
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required.',
                requestId: apiRequestId,
            });
        }

        try {
            validateRequestShape(event);
            const sourceKeys = parseSourceKeys(event);
            const parsedSources = validateSourceKeys(sourceKeys);
            const currentProfile = await palateProfileStore.getCurrentPalateProfile(userId);

            if (!currentProfile) {
                return errorResponse({
                    statusCode: 404,
                    code: 'PALATE_PROFILE_NOT_FOUND',
                    message: 'A current palate profile was not found.',
                    requestId: apiRequestId,
                });
            }

            const resolvedSources = await Promise.all(parsedSources.map(source =>
                resolveSource({
                    source,
                    userId,
                    catalogueStore,
                    manualWineStore,
                })
            ));
            const invalidSourceKeys = resolvedSources.flatMap((result, index) =>
                result ? [] : [parsedSources[index].sourceKey]
            );

            if (invalidSourceKeys.length > 0) {
                return errorResponse({
                    statusCode: 404,
                    code: 'ASSESSMENT_SOURCE_NOT_FOUND',
                    message: 'One or more assessment sources were not found.',
                    details: { sourceKeys: invalidSourceKeys },
                    requestId: apiRequestId,
                });
            }

            const allocations = await assessmentVersionStore.allocateNextAssessmentVersions({
                userId,
                sourceKeys,
            });
            const requestedAt = now();
            const requests = allocations.map((allocation, index) => ({
                requestId: createId(),
                source: resolvedSources[index].source,
                wineSnapshot: resolvedSources[index].wineSnapshot,
                sourceHash: resolvedSources[index].sourceHash,
                assessmentVersion: allocation.assessmentVersion,
                requestedAt,
                userId,
            }));
            const queueResults = await Promise.allSettled(requests.map(request =>
                assessmentQueue.enqueueAssessmentRequest(request)
            ));
            const presentedRequests = requests.map(toPresentedRequest);
            const queued = presentedRequests.filter((_request, index) =>
                queueResults[index].status === 'fulfilled'
            );
            const notQueued = presentedRequests
                .filter((_request, index) => queueResults[index].status === 'rejected')
                .map(({ sourceKey, assessmentVersion }) => ({
                    sourceKey,
                    assessmentVersion,
                }));

            if (notQueued.length > 0) {
                console.error(
                    `Assessment queue unavailable requestId=${ apiRequestId } queued=${ queued.length } notQueued=${ notQueued.length }`
                );
                return errorResponse({
                    statusCode: 503,
                    code: 'ASSESSMENT_QUEUE_UNAVAILABLE',
                    message: 'One or more assessment requests could not be queued.',
                    details: { queued, notQueued },
                    requestId: apiRequestId,
                });
            }

            return successResponse({
                statusCode: 202,
                data: { requests: presentedRequests },
                requestId: apiRequestId,
            });
        } catch (error) {
            if (error instanceof AssessmentRequestApiError) {
                return errorResponse({
                    statusCode: error.statusCode,
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    requestId: apiRequestId,
                });
            }

            console.error(
                `Assessment request failed requestId=${ apiRequestId } errorName=${ error?.name ?? 'Error' }`
            );
            return errorResponse({
                statusCode: 500,
                code: 'INTERNAL_ERROR',
                message: 'The assessment request could not be completed.',
                requestId: apiRequestId,
            });
        }
    };
};

const validateRequestShape = event => {
    if (event?.routeKey !== ROUTE) {
        throw invalidRequest('route', 'route is not supported');
    }
    if (
        event?.queryStringParameters
        && Object.keys(event.queryStringParameters).length > 0
    ) {
        throw invalidRequest('query', 'query parameters are not supported');
    }
};

const parseSourceKeys = event => {
    if (typeof event?.body !== 'string' || event.body.length === 0) {
        throw invalidRequest('body', 'body is required');
    }

    let body;
    try {
        const text = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body;
        body = JSON.parse(text);
    } catch {
        throw invalidRequest('body', 'body must be valid JSON');
    }

    if (!body || Array.isArray(body) || typeof body !== 'object') {
        throw invalidRequest('body', 'body must be a JSON object');
    }
    const fields = Object.keys(body);
    if (fields.some(field => field !== 'sourceKeys')) {
        throw invalidRequest('body', 'body contains unsupported fields');
    }
    if (!Array.isArray(body.sourceKeys)) {
        throw validationFailed('sourceKeys', 'must be an array');
    }

    return body.sourceKeys;
};

const validateSourceKeys = sourceKeys => {
    if (sourceKeys.length < 1 || sourceKeys.length > MAX_SOURCE_KEYS) {
        throw validationFailed(
            'sourceKeys',
            `must contain between 1 and ${ MAX_SOURCE_KEYS } items`
        );
    }
    if (new Set(sourceKeys).size !== sourceKeys.length) {
        throw validationFailed('sourceKeys', 'must not contain duplicates');
    }

    return sourceKeys.map((sourceKey, index) => {
        const parsed = parseSourceKey(sourceKey);
        if (!parsed) {
            throw validationFailed(
                `sourceKeys[${ index }]`,
                'must be a valid retailer or manual source key'
            );
        }
        return parsed;
    });
};

const parseSourceKey = sourceKey => {
    if (typeof sourceKey !== 'string') return undefined;

    if (sourceKey.startsWith('manual:')) {
        const manualWineId = sourceKey.slice('manual:'.length);
        return isManualWineId(manualWineId)
            ? { type: 'manual', sourceKey, manualWineId }
            : undefined;
    }

    const retailerMatch = /^retailer:([^:]+):(.+)$/.exec(sourceKey);
    if (!retailerMatch) return undefined;

    return {
        type: 'retailer',
        sourceKey,
        retailerId: retailerMatch[1],
        wineId: retailerMatch[2],
    };
};

const resolveSource = async ({
    source,
    userId,
    catalogueStore,
    manualWineStore,
}) => {
    if (source.type === 'retailer') {
        const wine = await catalogueStore.getCurrentWine({
            retailerId: source.retailerId,
            wineId: source.wineId,
        });

        if (!wine || wine.sourceKey !== source.sourceKey || !wine.sourceHash) {
            return undefined;
        }

        return {
            source: { type: 'retailer', key: source.sourceKey },
            wineSnapshot: buildRetailerWineSnapshot(wine),
            sourceHash: wine.sourceHash,
        };
    }

    const wine = await manualWineStore.getManualWineBySourceKey({
        userId,
        sourceKey: source.sourceKey,
    });

    if (
        !wine
        || wine.status !== 'active'
        || wine.isActive !== true
        || wine.sourceKey !== source.sourceKey
        || !wine.sourceHash
    ) {
        return undefined;
    }

    return {
        source: { type: 'manual', key: source.sourceKey },
        wineSnapshot: buildManualWineSnapshot(wine),
        sourceHash: wine.sourceHash,
    };
};

const buildRetailerWineSnapshot = wine => ({
    id: wine.id,
    region: wine.region,
    name: wine.name,
    vintage: wine.vintage,
    price: wine.price,
    grape: wine.grape,
    alcohol: wine.alcohol,
    description: wine.description,
    sourceHash: wine.sourceHash,
});

const buildManualWineSnapshot = wine => ({
    id: wine.id,
    name: wine.name,
    vintage: wine.vintage,
    description: wine.description,
    sourceHash: wine.sourceHash,
});

const toPresentedRequest = request => ({
    sourceKey: request.source.key,
    requestId: request.requestId,
    assessmentVersion: request.assessmentVersion,
});

const invalidRequest = (field, reason) => new AssessmentRequestApiError({
    statusCode: 400,
    code: 'INVALID_REQUEST',
    message: 'The request is invalid.',
    details: [{ field, reason }],
});

const validationFailed = (field, reason) => new AssessmentRequestApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'The request did not pass validation.',
    details: [{ field, reason }],
});

class AssessmentRequestApiError extends Error {
    constructor({ statusCode, code, message, details }) {
        super(message);
        this.name = 'AssessmentRequestApiError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

const successResponse = ({ statusCode, data, requestId }) => ({
    statusCode,
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify({
        data,
        meta: { requestId },
    }),
});

const errorResponse = ({
    statusCode,
    code,
    message,
    requestId,
    details,
}) => ({
    statusCode,
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify({
        error: {
            code,
            message,
            ...(details === undefined ? {} : { details }),
        },
        meta: { requestId },
    }),
});

const createDefaultHandler = () => createAssessmentRequestsHandler({
    palateProfileStore: createPalateProfileStore({ client: documentClient }),
    catalogueStore: createCatalogueStore({ client: documentClient }),
    manualWineStore: createManualWineStore({ client: documentClient }),
    assessmentVersionStore: createAssessmentVersionStore({ client: documentClient }),
    assessmentQueue: createAssessmentQueue(sqsClient),
});

let defaultHandler;

export const handler = event => {
    defaultHandler ??= createDefaultHandler();
    return defaultHandler(event);
};

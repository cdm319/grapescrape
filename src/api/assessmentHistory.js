import { createAssessmentHistoryStore } from '@grapescrape/state/dynamodb/assessmentHistoryStore';
import { documentClient } from '@grapescrape/state/dynamodb/client';
import { AssessmentHistoryApiError } from './assessmentHistoryApiError.js';
import { createAssessmentHistoryService } from './assessmentHistoryService.js';

const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
};

// CM-42 owns the manual-wine storage keys. Keep this failure explicit until
// that ticket provides the user-scoped read adapter used by the service.
const unconfiguredManualWineReader = async () => {
    const error = new Error('Manual wine read contract is not configured');
    error.name = 'ManualWineReadContractUnavailableError';
    throw error;
};

export const createAssessmentHistoryHandler = ({
    historyStore,
    getManualWineBySourceKey,
} = {}) => {
    const service = createAssessmentHistoryService({
        historyStore,
        getManualWineBySourceKey,
    });

    return async event => {
        const requestId = event?.requestContext?.requestId ?? 'unknown';

        try {
            const userId = event?.requestContext?.authorizer?.jwt?.claims?.sub;

            if (!userId) {
                return errorResponse({
                    statusCode: 401,
                    code: 'UNAUTHENTICATED',
                    message: 'Authentication is required.',
                    requestId,
                });
            }

            if (event.body !== undefined && event.body !== null) {
                throw new AssessmentHistoryApiError({
                    statusCode: 400,
                    code: 'INVALID_REQUEST',
                    message: 'The request must not include a body.',
                });
            }

            const query = event.queryStringParameters ?? {};
            const routeKey = event.routeKey;
            const pathSourceKey = event.pathParameters?.sourceKey;

            if (routeKey === 'GET /v1/assessed-wines') {
                const page = await service.listAssessedWines({ userId, query });
                return listResponse(page, requestId);
            }

            const sourceKey = readSourceKey(pathSourceKey);

            if (routeKey === 'GET /v1/assessed-wines/{sourceKey}') {
                rejectAnyQuery(query);
                const assessedWine = await service.getAssessedWine({ userId, sourceKey });
                return successResponse(assessedWine, requestId);
            }

            if (
                routeKey
                === 'GET /v1/assessed-wines/{sourceKey}/assessments'
            ) {
                const page = await service.listAssessments({
                    userId,
                    sourceKey,
                    query,
                });
                return listResponse(page, requestId);
            }

            if (
                routeKey
                === 'GET /v1/assessed-wines/{sourceKey}/assessments/{assessmentVersion}'
            ) {
                rejectAnyQuery(query);
                const assessmentVersion = parsePathAssessmentVersion(
                    event.pathParameters?.assessmentVersion
                );
                const assessment = await service.getAssessmentVersion({
                    userId,
                    sourceKey,
                    assessmentVersion,
                });
                return successResponse(assessment, requestId);
            }

            return errorResponse({
                statusCode: 404,
                code: 'NOT_FOUND',
                message: 'The requested route was not found.',
                requestId,
            });
        } catch (error) {
            if (error instanceof AssessmentHistoryApiError) {
                return errorResponse({
                    statusCode: error.statusCode,
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    requestId,
                });
            }

            console.error(
                `Assessment history request failed requestId=${ requestId } errorName=${ error?.name ?? 'Error' }`
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

export const handler = event => createAssessmentHistoryHandler({
    historyStore: createAssessmentHistoryStore({
        client: documentClient,
    }),
    getManualWineBySourceKey: unconfiguredManualWineReader,
})(event);

const readSourceKey = value => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The source key is invalid.',
        });
    }

    return value;
};

const parsePathAssessmentVersion = value => {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The assessment version is invalid.',
        });
    }

    const assessmentVersion = Number(value);

    if (!Number.isSafeInteger(assessmentVersion)) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The assessment version is invalid.',
        });
    }

    return assessmentVersion;
};

const rejectAnyQuery = query => {
    if (Object.keys(query).length > 0) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The request must not include query parameters.',
        });
    }
};

const successResponse = (data, requestId) => ({
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
        data,
        meta: {
            requestId,
        },
    }),
});

const listResponse = ({ items, nextCursor }, requestId) => ({
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
        data: {
            items,
        },
        meta: {
            requestId,
            nextCursor,
        },
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
    headers: JSON_HEADERS,
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

import { randomUUID } from 'node:crypto';
import {
    createManualWineIdentity,
    createManualWineSourceHash,
    isManualWineId,
    validateManualWineCreateInput,
    validateManualWinePatchInput,
} from '@grapescrape/domain/wine/manualWine';
import { documentClient } from '@grapescrape/state/dynamodb/client';
import {
    createManualWineAssessmentReadStore,
    createManualWineStore,
    isManualWineAlreadyExists,
    isManualWineDeleted,
    isManualWineNotFound,
} from '@grapescrape/state/dynamodb/manualWineStore';
import {
    paginateManualWines,
    parseManualWineListQuery,
} from './manualWineList.js';
import { presentManualWine } from './manualWinePresentation.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const COLLECTION_PATH = '/v1/manual-wines';
const ITEM_PATH = '/v1/manual-wines/{manualWineId}';

export const createManualWinesHandler = ({
    manualWineStore,
    assessmentReadStore,
    createId = randomUUID,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
    assessmentsTableName = process.env.ASSESSMENTS_TABLE_NAME,
} = {}) => {
    let resolvedManualWineStore = manualWineStore;
    let resolvedAssessmentReadStore = assessmentReadStore;

    const getManualWineStore = () => {
        resolvedManualWineStore ??= createManualWineStore({
            client: documentClient,
            userDataTableName,
        });
        return resolvedManualWineStore;
    };
    const getAssessmentReadStore = () => {
        resolvedAssessmentReadStore ??= createManualWineAssessmentReadStore({
            client: documentClient,
            assessmentsTableName,
        });
        return resolvedAssessmentReadStore;
    };

    return async event => {
        const requestId = event?.requestContext?.requestId ?? 'unknown';
        const subject = event?.requestContext?.authorizer?.jwt?.claims?.sub;

        if (!subject) {
            return errorResponse({
                statusCode: 401,
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required.',
                requestId,
            });
        }

        const routeKey = resolveRouteKey(event);

        try {
            if (routeKey === `GET ${ COLLECTION_PATH }`) {
                return await listManualWines({
                    event,
                    requestId,
                    userId: subject,
                    manualWineStore: getManualWineStore(),
                    assessmentReadStore: getAssessmentReadStore(),
                });
            }
            if (routeKey === `POST ${ COLLECTION_PATH }`) {
                return await createManualWine({
                    event,
                    requestId,
                    userId: subject,
                    createId,
                    manualWineStore: getManualWineStore(),
                });
            }
            if (routeKey === `GET ${ ITEM_PATH }`) {
                return await getManualWine({
                    event,
                    requestId,
                    userId: subject,
                    manualWineStore: getManualWineStore(),
                    assessmentReadStore: getAssessmentReadStore(),
                });
            }
            if (routeKey === `PATCH ${ ITEM_PATH }`) {
                return await patchManualWine({
                    event,
                    requestId,
                    userId: subject,
                    manualWineStore: getManualWineStore(),
                    assessmentReadStore: getAssessmentReadStore(),
                });
            }
            if (routeKey === `DELETE ${ ITEM_PATH }`) {
                return await deleteManualWine({
                    event,
                    requestId,
                    userId: subject,
                    manualWineStore: getManualWineStore(),
                });
            }

            return invalidRequest({
                requestId,
                details: [{
                    field: 'route',
                    reason: 'route is not supported',
                }],
            });
        } catch (error) {
            if (isManualWineAlreadyExists(error)) {
                return errorResponse({
                    statusCode: 409,
                    code: 'MANUAL_WINE_ALREADY_EXISTS',
                    message: 'A manual wine with this name and vintage already exists.',
                    requestId,
                });
            }
            if (isManualWineNotFound(error)) {
                return manualWineNotFound(requestId);
            }
            if (isManualWineDeleted(error)) {
                return manualWineDeleted(requestId);
            }
            if (error?.name === 'InvalidCursorError') {
                return errorResponse({
                    statusCode: 400,
                    code: 'INVALID_CURSOR',
                    message: 'The cursor is invalid for this query.',
                    requestId,
                });
            }

            console.error('Failed to handle manual wine request', {
                requestId,
                errorName: error?.name ?? 'Error',
            });

            return errorResponse({
                statusCode: 500,
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred.',
                requestId,
            });
        }
    };
};

export const handler = createManualWinesHandler();

const listManualWines = async ({
    event,
    requestId,
    userId,
    manualWineStore,
    assessmentReadStore,
}) => {
    if (hasBody(event)) {
        return invalidRequest({
            requestId,
            details: [{
                field: 'body',
                reason: 'request body is not allowed',
            }],
        });
    }

    const queryValidation = parseManualWineListQuery(
        event?.queryStringParameters,
    );

    if (!queryValidation.valid) {
        return queryValidation.validationFailed
            ? validationFailed({
                requestId,
                details: queryValidation.errors,
            })
            : invalidRequest({
                requestId,
                details: queryValidation.errors,
            });
    }

    const wines = await manualWineStore.listActiveManualWines(userId);
    const page = paginateManualWines(wines, queryValidation.value);
    const items = await presentManualWineRecords({
        manualWines: page.items,
        userId,
        manualWineStore,
        assessmentReadStore,
    });

    return successResponse({
        statusCode: 200,
        data: { items },
        requestId,
        meta: {
            nextCursor: page.nextCursor,
        },
    });
};

const createManualWine = async ({
    event,
    requestId,
    userId,
    createId,
    manualWineStore,
}) => {
    if (hasQuery(event)) {
        return invalidRequest({
            requestId,
            details: [{
                field: 'query',
                reason: 'query parameters are not allowed',
            }],
        });
    }

    const parsed = parseBody(event?.body);

    if (!parsed.valid) {
        return invalidRequest({
            requestId,
            details: parsed.errors,
        });
    }

    const validation = validateManualWineCreateInput(parsed.value);

    if (!validation.valid) {
        return validation.hasUnknownFields
            || validation.errors.some(error => error.reason === 'must be a JSON object')
            ? invalidRequest({
                requestId,
                details: validation.errors,
            })
            : validationFailed({
                requestId,
                details: validation.errors,
            });
    }

    const manualWineId = createId();

    if (!isManualWineId(manualWineId)) {
        throw new Error('Generated manual wine ID is not a UUID');
    }

    const currentPalateProfileVersion =
        await manualWineStore.getCurrentPalateProfileVersion(userId);
    const sourceHash = createManualWineSourceHash(parsed.value);
    const manualWine = await manualWineStore.createManualWine({
        userId,
        manualWineId,
        ...parsed.value,
        identity: createManualWineIdentity(parsed.value),
        sourceHash,
    });

    return successResponse({
        statusCode: 201,
        data: presentManualWine({
            manualWine,
            latestAssessment: undefined,
            currentPalateProfileVersion,
        }),
        requestId,
    });
};

const getManualWine = async ({
    event,
    requestId,
    userId,
    manualWineStore,
    assessmentReadStore,
}) => {
    const requestError = validateItemRequest(event);
    if (requestError) {
        return requestError.response(requestId);
    }

    const manualWine = await manualWineStore.getManualWineById({
        userId,
        manualWineId: event.pathParameters.manualWineId,
    });

    if (!manualWine) return manualWineNotFound(requestId);
    if (manualWine.status === 'deleted') {
        return manualWineDeleted(requestId);
    }

    const [presented] = await presentManualWineRecords({
        manualWines: [manualWine],
        userId,
        manualWineStore,
        assessmentReadStore,
    });

    return successResponse({
        statusCode: 200,
        data: presented,
        requestId,
    });
};

const patchManualWine = async ({
    event,
    requestId,
    userId,
    manualWineStore,
    assessmentReadStore,
}) => {
    const pathError = validateManualWinePath(event);
    if (pathError) return pathError.response(requestId);
    if (hasQuery(event)) {
        return invalidRequest({
            requestId,
            details: [{
                field: 'query',
                reason: 'query parameters are not allowed',
            }],
        });
    }

    const parsed = parseBody(event?.body);
    if (!parsed.valid) {
        return invalidRequest({
            requestId,
            details: parsed.errors,
        });
    }

    const validation = validateManualWinePatchInput(parsed.value);
    if (!validation.valid) {
        return validation.hasUnknownFields
            || validation.errors.some(error => error.reason === 'must be a JSON object')
            ? invalidRequest({
                requestId,
                details: validation.errors,
            })
            : validationFailed({
                requestId,
                details: validation.errors,
            });
    }

    const manualWineId = event.pathParameters.manualWineId;
    const existing = await manualWineStore.getManualWineById({
        userId,
        manualWineId,
    });

    if (!existing) return manualWineNotFound(requestId);
    if (existing.status === 'deleted') return manualWineDeleted(requestId);

    const updated = await manualWineStore.updateManualWineDescription({
        userId,
        manualWineId,
        description: parsed.value.description,
        sourceHash: createManualWineSourceHash({
            name: existing.name,
            vintage: existing.vintage,
            description: parsed.value.description,
        }),
    });
    const [presented] = await presentManualWineRecords({
        manualWines: [updated],
        userId,
        manualWineStore,
        assessmentReadStore,
    });

    return successResponse({
        statusCode: 200,
        data: presented,
        requestId,
    });
};

const deleteManualWine = async ({
    event,
    requestId,
    userId,
    manualWineStore,
}) => {
    const requestError = validateItemRequest(event);
    if (requestError) {
        return requestError.response(requestId);
    }

    const manualWine = await manualWineStore.softDeleteManualWine({
        userId,
        manualWineId: event.pathParameters.manualWineId,
    });

    return successResponse({
        statusCode: 200,
        data: {
            id: manualWine.id,
            sourceKey: manualWine.sourceKey,
            status: 'deleted',
            deletedAt: manualWine.deletedAt,
        },
        requestId,
    });
};

const presentManualWineRecords = async ({
    manualWines,
    userId,
    manualWineStore,
    assessmentReadStore,
}) => {
    if (manualWines.length === 0) return [];

    const [
        currentPalateProfileVersion,
        ...latestAssessments
    ] = await Promise.all([
        manualWineStore.getCurrentPalateProfileVersion(userId),
        ...manualWines.map(manualWine =>
            assessmentReadStore.getHighestCompletedAssessment({
                userId,
                sourceKey: manualWine.sourceKey,
            })),
    ]);

    return manualWines.map((manualWine, index) => presentManualWine({
        manualWine,
        latestAssessment: latestAssessments[index],
        currentPalateProfileVersion,
    }));
};

const validateItemRequest = event => {
    const pathError = validateManualWinePath(event);
    if (pathError) return pathError;
    if (hasQuery(event)) {
        return {
            response: requestId => invalidRequest({
                requestId,
                details: [{
                    field: 'query',
                    reason: 'query parameters are not allowed',
                }],
            }),
        };
    }
    if (hasBody(event)) {
        return {
            response: requestId => invalidRequest({
                requestId,
                details: [{
                    field: 'body',
                    reason: 'request body is not allowed',
                }],
            }),
        };
    }
    return undefined;
};

const validateManualWinePath = event => {
    const manualWineId = event?.pathParameters?.manualWineId;

    if (isManualWineId(manualWineId)) return undefined;

    return {
        response: requestId => invalidRequest({
            requestId,
            details: [{
                field: 'manualWineId',
                reason: 'must be a UUID',
            }],
        }),
    };
};

const parseBody = body => {
    if (typeof body !== 'string' || body.length === 0) {
        return {
            valid: false,
            errors: [{
                field: 'body',
                reason: 'a JSON request body is required',
            }],
        };
    }

    try {
        return {
            valid: true,
            value: JSON.parse(body),
        };
    } catch {
        return {
            valid: false,
            errors: [{
                field: 'body',
                reason: 'must contain valid JSON',
            }],
        };
    }
};

const resolveRouteKey = event => {
    if (event?.routeKey) return event.routeKey;

    const method = event?.requestContext?.http?.method;
    const path = event?.pathParameters?.manualWineId
        ? ITEM_PATH
        : COLLECTION_PATH;
    return `${ method } ${ path }`;
};

const hasQuery = event =>
    event?.queryStringParameters
    && Object.keys(event.queryStringParameters).length > 0;

const hasBody = event =>
    typeof event?.body === 'string'
    && event.body.length > 0;

const manualWineNotFound = requestId => errorResponse({
    statusCode: 404,
    code: 'MANUAL_WINE_NOT_FOUND',
    message: 'The manual wine was not found.',
    requestId,
});

const manualWineDeleted = requestId => errorResponse({
    statusCode: 410,
    code: 'MANUAL_WINE_DELETED',
    message: 'The manual wine has been deleted.',
    requestId,
});

const successResponse = ({
    statusCode,
    data,
    requestId,
    meta = {},
}) => ({
    statusCode,
    headers: {
        'content-type': JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
        data,
        meta: {
            requestId,
            ...meta,
        },
    }),
});

const invalidRequest = ({ requestId, details }) => errorResponse({
    statusCode: 400,
    code: 'INVALID_REQUEST',
    message: 'The request is invalid.',
    requestId,
    details,
});

const validationFailed = ({ requestId, details }) => errorResponse({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'The request did not pass validation.',
    requestId,
    details,
});

const errorResponse = ({
    statusCode,
    code,
    message,
    requestId,
    details,
}) => ({
    statusCode,
    headers: {
        'content-type': JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
        error: {
            code,
            message,
            ...(details === undefined ? {} : { details }),
        },
        meta: {
            requestId,
        },
    }),
});

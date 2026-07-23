import { validatePalateProfile } from '@grapescrape/domain/palate-profile/validatePalateProfile';
import { documentClient } from '@grapescrape/state/dynamodb/client';
import {
    createPalateProfileStore,
    isPalateProfileVersionConflict,
} from '@grapescrape/state/dynamodb/palateProfileStore';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const PUT_BODY_FIELDS = ['expectedPalateProfileVersion', 'profile'];

export const createPalateProfileHandler = ({
    palateProfileStore,
    userDataTableName = process.env.USER_DATA_TABLE_NAME,
} = {}) => async event => {
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

    if (hasQueryParameters(event)) {
        return invalidRequest({
            requestId,
            details: [{
                field: 'query',
                reason: 'query parameters are not allowed',
            }],
        });
    }

    const store = palateProfileStore ?? createPalateProfileStore({
        client: documentClient,
        userDataTableName,
    });
    const method = event?.requestContext?.http?.method;

    try {
        if (method === 'GET') {
            if (hasRequestBody(event)) {
                return invalidRequest({
                    requestId,
                    details: [{
                        field: 'body',
                        reason: 'request body is not allowed',
                    }],
                });
            }

            const profile = await store.getCurrentPalateProfile(subject);

            if (!profile) {
                return errorResponse({
                    statusCode: 404,
                    code: 'PALATE_PROFILE_NOT_FOUND',
                    message: 'No palate profile was found.',
                    requestId,
                });
            }

            return successResponse({
                data: profile,
                requestId,
            });
        }

        if (method === 'PUT') {
            const parsedBody = parseJsonBody(event.body);

            if (!parsedBody.valid) {
                return invalidRequest({
                    requestId,
                    details: parsedBody.errors,
                });
            }

            const bodyErrors = validatePutBody(parsedBody.value);

            if (bodyErrors.length > 0) {
                const malformedShape = bodyErrors.some(
                    error => [
                        'is not allowed',
                        'must be a JSON object',
                    ].includes(error.reason),
                );

                return malformedShape
                    ? invalidRequest({
                        requestId,
                        details: bodyErrors,
                    })
                    : validationFailed({
                        requestId,
                        details: bodyErrors,
                    });
            }

            const profileValidation = validatePalateProfile(
                parsedBody.value.profile,
            );

            if (!profileValidation.valid) {
                const containsUnknownFields = profileValidation.errors.some(
                    error => error.reason === 'is not allowed',
                );

                return containsUnknownFields
                    ? invalidRequest({
                        requestId,
                        details: profileValidation.errors,
                    })
                    : validationFailed({
                        requestId,
                        details: profileValidation.errors,
                    });
            }

            const profile = await store.putNextPalateProfile({
                userId: subject,
                expectedPalateProfileVersion:
                    parsedBody.value.expectedPalateProfileVersion,
                profile: parsedBody.value.profile,
            });

            return successResponse({
                data: profile,
                requestId,
            });
        }

        return invalidRequest({
            requestId,
            details: [{
                field: 'method',
                reason: 'method is not supported',
            }],
        });
    } catch (error) {
        if (isPalateProfileVersionConflict(error)) {
            return errorResponse({
                statusCode: 409,
                code: 'PROFILE_VERSION_CONFLICT',
                message: 'The palate profile has changed.',
                requestId,
                details: {
                    currentPalateProfileVersion:
                        error.currentPalateProfileVersion ?? null,
                },
            });
        }

        console.error('Failed to handle palate profile request', {
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

export const handler = createPalateProfileHandler();

const validatePutBody = body => {
    if (!isPlainObject(body)) {
        return [{
            field: 'body',
            reason: 'must be a JSON object',
        }];
    }

    const errors = [];
    const fields = Object.keys(body);

    for (const field of fields) {
        if (!PUT_BODY_FIELDS.includes(field)) {
            errors.push({
                field,
                reason: 'is not allowed',
            });
        }
    }

    for (const field of PUT_BODY_FIELDS) {
        if (!fields.includes(field)) {
            errors.push({
                field,
                reason: 'is required',
            });
        }
    }

    if (
        fields.includes('expectedPalateProfileVersion')
        && body.expectedPalateProfileVersion !== null
        && (
            !Number.isSafeInteger(body.expectedPalateProfileVersion)
            || body.expectedPalateProfileVersion < 1
        )
    ) {
        errors.push({
            field: 'expectedPalateProfileVersion',
            reason: 'must be null or a positive integer',
        });
    }

    return errors;
};

const parseJsonBody = body => {
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

const isPlainObject = value =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value);

const hasQueryParameters = event =>
    isPlainObject(event?.queryStringParameters)
    && Object.keys(event.queryStringParameters).length > 0;

const hasRequestBody = event =>
    typeof event?.body === 'string'
    && event.body.length > 0;

const successResponse = ({ data, requestId }) => ({
    statusCode: 200,
    headers: {
        'content-type': JSON_CONTENT_TYPE,
    },
    body: JSON.stringify({
        data,
        meta: {
            requestId,
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

export class AssessmentHistoryApiError extends Error {
    constructor({ statusCode, code, message, details }) {
        super(message);
        this.name = 'AssessmentHistoryApiError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

export const validationFailed = (field, reason) =>
    new AssessmentHistoryApiError({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'The request did not pass validation.',
        details: [{ field, reason }],
    });

export const invalidCursor = () =>
    new AssessmentHistoryApiError({
        statusCode: 400,
        code: 'INVALID_CURSOR',
        message: 'The cursor is invalid for this request.',
    });

export const notFound = (code, message) =>
    new AssessmentHistoryApiError({
        statusCode: 404,
        code,
        message,
    });

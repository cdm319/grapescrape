export class CatalogueApiError extends Error {
    constructor({
        statusCode,
        code,
        message,
        details,
    }) {
        super(message);
        this.name = 'CatalogueApiError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

export const validationError = (field, reason) => new CatalogueApiError({
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'The request did not pass validation.',
    details: [{
        field: `query.${ field }`,
        reason,
    }],
});

export const invalidCursor = () => new CatalogueApiError({
    statusCode: 400,
    code: 'INVALID_CURSOR',
    message: 'The pagination cursor is invalid.',
});

export const invalidSourceKey = () => new CatalogueApiError({
    statusCode: 400,
    code: 'INVALID_REQUEST',
    message: 'The request is invalid.',
    details: [{
        field: 'path.sourceKey',
        reason: 'must be a retailer source key',
    }],
});

export const catalogueWineNotFound = () => new CatalogueApiError({
    statusCode: 404,
    code: 'CATALOGUE_WINE_NOT_FOUND',
    message: 'The catalogue wine was not found.',
});

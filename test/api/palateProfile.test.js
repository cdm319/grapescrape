import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPalateProfileHandler } from '../../src/api/palateProfile.js';

const PROFILE_VERSION = {
    palateProfileVersion: 1,
    stylePreferences: {
        body: { preferred: ['medium'], avoided: [] },
        fruitRipeness: { preferred: ['ripe'], avoided: [] },
        fruitCharacter: { preferred: ['black_cherry'], avoided: [] },
        texture: { preferred: ['silky'], avoided: [] },
        oakInfluence: { preferred: ['subtle'], avoided: [] },
        tannin: { preferred: ['moderate'], avoided: [] },
        acidity: { preferred: ['fresh'], avoided: [] },
        development: { preferred: ['ready_to_drink'], avoided: [] },
        styleTags: { preferred: ['elegant'], avoided: [] },
    },
    wineExamples: [{
        id: 'b8fb634f-13a5-4f0d-9183-f257a35a0211',
        name: 'Example wine',
        vintage: '2020',
        sentiment: 'enjoyed',
        notes: 'Balanced and fresh.',
    }],
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
};

const PROFILE_INPUT = {
    stylePreferences: PROFILE_VERSION.stylePreferences,
    wineExamples: PROFILE_VERSION.wineExamples,
};

describe('palate profile API handler', () => {
    let palateProfileStore;
    let handler;

    beforeEach(() => {
        palateProfileStore = {
            getCurrentPalateProfile: vi.fn(),
            putNextPalateProfile: vi.fn(),
        };
        handler = createPalateProfileHandler({ palateProfileStore });
    });

    it('gets the current profile for the authenticated Cognito subject', async () => {
        palateProfileStore.getCurrentPalateProfile.mockResolvedValue(
            PROFILE_VERSION,
        );

        const response = await handler(apiEvent({ method: 'GET' }));

        expect(palateProfileStore.getCurrentPalateProfile)
            .toHaveBeenCalledWith('cognito-sub-123');
        expectJsonResponse(response, 200, {
            data: PROFILE_VERSION,
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('returns the shared not-found error when no profile exists', async () => {
        palateProfileStore.getCurrentPalateProfile.mockResolvedValue(undefined);

        const response = await handler(apiEvent({ method: 'GET' }));

        expectJsonResponse(response, 404, {
            error: {
                code: 'PALATE_PROFILE_NOT_FOUND',
                message: 'No palate profile was found.',
            },
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('rejects client-supplied identity in query parameters', async () => {
        const response = await handler(apiEvent({
            method: 'GET',
            queryStringParameters: {
                userId: 'different-user',
            },
        }));

        expect(palateProfileStore.getCurrentPalateProfile)
            .not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('INVALID_REQUEST');
    });

    it('rejects a request body on GET', async () => {
        const response = await handler(apiEvent({
            method: 'GET',
            body: '{}',
        }));

        expect(palateProfileStore.getCurrentPalateProfile)
            .not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('INVALID_REQUEST');
    });

    it.each([
        ['an initial profile', null],
        ['the next profile version', 3],
    ])('puts %s using only the authenticated subject', async (
        _description,
        expectedPalateProfileVersion,
    ) => {
        palateProfileStore.putNextPalateProfile.mockResolvedValue({
            ...PROFILE_VERSION,
            palateProfileVersion:
                expectedPalateProfileVersion === null
                    ? 1
                    : expectedPalateProfileVersion + 1,
        });

        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion,
                profile: PROFILE_INPUT,
            }),
        }));

        expect(palateProfileStore.putNextPalateProfile).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            expectedPalateProfileVersion,
            profile: PROFILE_INPUT,
        });
        expect(response.statusCode).toBe(200);
    });

    it('rejects client-supplied identity in the request body', async () => {
        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion: null,
                profile: PROFILE_INPUT,
                userId: 'different-user',
            }),
        }));

        expect(palateProfileStore.putNextPalateProfile).not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('INVALID_REQUEST');
    });

    it.each([
        ['a missing body', undefined],
        ['malformed JSON', '{"profile":'],
        ['a non-object body', '[]'],
    ])('rejects %s', async (_description, body) => {
        const response = await handler(apiEvent({
            method: 'PUT',
            body,
        }));

        expect(palateProfileStore.putNextPalateProfile).not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('INVALID_REQUEST');
    });

    it.each([0, -1, 1.5, '1', false])(
        'rejects invalid expected version %j',
        async expectedPalateProfileVersion => {
            const response = await handler(apiEvent({
                method: 'PUT',
                body: JSON.stringify({
                    expectedPalateProfileVersion,
                    profile: PROFILE_INPUT,
                }),
            }));

            expect(palateProfileStore.putNextPalateProfile)
                .not.toHaveBeenCalled();
            expect(errorCode(response)).toBe('VALIDATION_FAILED');
        },
    );

    it('returns validation errors for missing known fields', async () => {
        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion: null,
            }),
        }));

        expect(palateProfileStore.putNextPalateProfile).not.toHaveBeenCalled();
        expectJsonResponse(response, 400, {
            error: {
                code: 'VALIDATION_FAILED',
                message: 'The request did not pass validation.',
                details: [{
                    field: 'profile',
                    reason: 'is required',
                }],
            },
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('returns structured profile validation errors', async () => {
        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion: null,
                profile: {
                    ...PROFILE_INPUT,
                    stylePreferences: {
                        ...PROFILE_INPUT.stylePreferences,
                        body: {
                            preferred: ['enormous'],
                            avoided: [],
                        },
                    },
                },
            }),
        }));

        expect(palateProfileStore.putNextPalateProfile).not.toHaveBeenCalled();
        expectJsonResponse(response, 400, {
            error: {
                code: 'VALIDATION_FAILED',
                message: 'The request did not pass validation.',
                details: [{
                    field: 'profile.stylePreferences.body.preferred[0]',
                    reason: 'must be an allowed style value',
                }],
            },
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('returns INVALID_REQUEST for unknown nested profile fields', async () => {
        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion: null,
                profile: {
                    ...PROFILE_INPUT,
                    userId: 'different-user',
                },
            }),
        }));

        expect(palateProfileStore.putNextPalateProfile).not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('INVALID_REQUEST');
    });

    it('returns a safe conflict with the current stored version', async () => {
        const conflict = new Error('conditional transaction failed with details');
        conflict.name = 'PalateProfileVersionConflictError';
        conflict.currentPalateProfileVersion = 5;
        conflict.isConditionalConflict = true;
        palateProfileStore.putNextPalateProfile.mockRejectedValue(conflict);

        const response = await handler(apiEvent({
            method: 'PUT',
            body: JSON.stringify({
                expectedPalateProfileVersion: 3,
                profile: PROFILE_INPUT,
            }),
        }));

        expectJsonResponse(response, 409, {
            error: {
                code: 'PROFILE_VERSION_CONFLICT',
                message: 'The palate profile has changed.',
                details: {
                    currentPalateProfileVersion: 5,
                },
            },
            meta: {
                requestId: 'request-123',
            },
        });
        expect(response.body).not.toContain('conditional transaction');
    });

    it('returns a safe unauthenticated error before accessing state', async () => {
        const event = apiEvent({ method: 'GET' });
        delete event.requestContext.authorizer.jwt.claims.sub;

        const response = await handler(event);

        expect(palateProfileStore.getCurrentPalateProfile)
            .not.toHaveBeenCalled();
        expect(errorCode(response)).toBe('UNAUTHENTICATED');
    });

    it('returns a safe internal error without leaking state errors', async () => {
        palateProfileStore.getCurrentPalateProfile.mockRejectedValue(
            new Error('database host and request details'),
        );
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const response = await handler(apiEvent({ method: 'GET' }));

        expect(errorCode(response)).toBe('INTERNAL_ERROR');
        expect(response.body).not.toContain('database host');
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to handle palate profile request',
            {
                requestId: 'request-123',
                errorName: 'Error',
            },
        );
        consoleError.mockRestore();
    });
});

const apiEvent = ({
    method,
    body,
    queryStringParameters,
}) => ({
    body,
    queryStringParameters,
    requestContext: {
        requestId: 'request-123',
        http: {
            method,
        },
        authorizer: {
            jwt: {
                claims: {
                    sub: 'cognito-sub-123',
                },
            },
        },
    },
});

const expectJsonResponse = (response, statusCode, body) => {
    expect(response).toEqual({
        statusCode,
        headers: {
            'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
    });
};

const errorCode = response => JSON.parse(response.body).error.code;

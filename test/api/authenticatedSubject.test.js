import { describe, expect, it } from 'vitest';
import { handler } from '../../src/api/authenticatedSubject.js';

describe('authenticatedSubject handler', () => {
    it('returns only the authenticated subject and request ID', async () => {
        const response = await handler({
            requestContext: {
                requestId: 'api-request-123',
                authorizer: {
                    jwt: {
                        claims: {
                            sub: 'user-subject-123',
                            email: 'person@example.com',
                            token_use: 'access',
                        },
                    },
                },
            },
        });

        expect(response).toEqual({
            statusCode: 200,
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                data: {
                    subject: 'user-subject-123',
                },
                meta: {
                    requestId: 'api-request-123',
                },
            }),
        });
    });

    it('returns a safe unauthenticated error when the subject claim is absent', async () => {
        const response = await handler({
            requestContext: {
                requestId: 'api-request-456',
                authorizer: {
                    jwt: {
                        claims: {},
                    },
                },
            },
        });

        expect(response).toEqual({
            statusCode: 401,
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                error: {
                    code: 'UNAUTHENTICATED',
                    message: 'Authentication is required.',
                },
                meta: {
                    requestId: 'api-request-456',
                },
            }),
        });
    });
});

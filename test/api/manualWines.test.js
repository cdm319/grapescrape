import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManualWineSourceHash } from '@grapescrape/domain/wine/manualWine';
import { createManualWinesHandler } from '../../src/api/manualWines.js';

const manualWineId = 'ffbd54ef-0c8e-49c7-a98e-e6703c08410e';
const sourceKey = `manual:${ manualWineId }`;
const manualWine = {
    userId: 'cognito-sub-123',
    id: manualWineId,
    sourceKey,
    source: { type: 'manual', key: sourceKey },
    name: 'Cellar Example',
    vintage: 'NV',
    description: 'Rich red fruit.',
    status: 'active',
    isActive: true,
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    deletedAt: null,
    sourceHash: createManualWineSourceHash({
        name: 'Cellar Example',
        vintage: 'NV',
        description: 'Rich red fruit.',
    }),
};

describe('manual wines API handler', () => {
    let store;
    let assessmentReadStore;
    let handler;

    beforeEach(() => {
        store = {
            createManualWine: vi.fn(),
            listActiveManualWines: vi.fn(),
            getManualWineById: vi.fn(),
            getCurrentPalateProfileVersion: vi.fn().mockResolvedValue(4),
            updateManualWineDescription: vi.fn(),
            softDeleteManualWine: vi.fn(),
        };
        assessmentReadStore = {
            getHighestCompletedAssessment: vi.fn().mockResolvedValue(undefined),
        };
        handler = createManualWinesHandler({
            manualWineStore: store,
            assessmentReadStore,
            createId: () => manualWineId,
        });
    });

    it('lists active wines with stable opaque cursor pagination and presentation', async () => {
        const other = {
            ...manualWine,
            id: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
            sourceKey: 'manual:7b15f900-7b70-43a7-8cfa-c270e38e704e',
            source: {
                type: 'manual',
                key: 'manual:7b15f900-7b70-43a7-8cfa-c270e38e704e',
            },
            name: 'Another Wine',
        };
        store.listActiveManualWines.mockResolvedValue([
            manualWine,
            other,
        ]);

        const first = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'name',
                direction: 'asc',
                limit: '1',
            },
        }));
        const firstBody = JSON.parse(first.body);

        expect(first.statusCode).toBe(200);
        expect(firstBody.data.items).toHaveLength(1);
        expect(firstBody.data.items[0].name).toBe('Another Wine');
        expect(firstBody.data.items[0]).not.toHaveProperty('sourceHash');
        expect(firstBody.data.items[0].freshness.status).toBe('unassessed');
        expect(firstBody.meta.nextCursor).toEqual(expect.any(String));
        expect(assessmentReadStore.getHighestCompletedAssessment)
            .toHaveBeenCalledOnce();

        const second = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'name',
                direction: 'asc',
                limit: '1',
                cursor: firstBody.meta.nextCursor,
            },
        }));
        const secondBody = JSON.parse(second.body);

        expect(secondBody.data.items[0].name).toBe('Cellar Example');
        expect(secondBody.meta.nextCursor).toBeNull();
    });

    it('filters list results by normalized name or vintage', async () => {
        store.listActiveManualWines.mockResolvedValue([
            manualWine,
            {
                ...manualWine,
                id: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
                name: 'Other Wine',
                vintage: '2020',
            },
        ]);

        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: { q: 'NV' },
        }));

        expect(JSON.parse(response.body).data.items.map(item => item.name))
            .toEqual(['Cellar Example']);
    });

    it('continues after a cursor anchor that was removed', async () => {
        const firstWine = {
            ...manualWine,
            id: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
            name: 'Another Wine',
        };
        store.listActiveManualWines
            .mockResolvedValueOnce([firstWine, manualWine])
            .mockResolvedValueOnce([manualWine]);

        const first = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'name',
                direction: 'asc',
                limit: '1',
            },
        }));
        const cursor = JSON.parse(first.body).meta.nextCursor;
        const second = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'name',
                direction: 'asc',
                limit: '1',
                cursor,
            },
        }));

        expect(JSON.parse(second.body).data.items[0].id)
            .toBe(manualWine.id);
    });

    it('continues from the encoded sort position when the anchor was updated', async () => {
        const firstWine = {
            ...manualWine,
            id: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
            updatedAt: '2026-07-23T09:00:00.000Z',
        };
        const movedFirstWine = {
            ...firstWine,
            updatedAt: '2026-07-23T12:00:00.000Z',
        };
        store.listActiveManualWines
            .mockResolvedValueOnce([firstWine, manualWine])
            .mockResolvedValueOnce([movedFirstWine, manualWine]);

        const first = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'updated',
                direction: 'asc',
                limit: '1',
            },
        }));
        const cursor = JSON.parse(first.body).meta.nextCursor;
        const second = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                sort: 'updated',
                direction: 'asc',
                limit: '1',
                cursor,
            },
        }));

        expect(JSON.parse(second.body).data.items[0].id)
            .toBe(manualWine.id);
    });

    it('binds cursors to the normalized search query', async () => {
        const other = {
            ...manualWine,
            id: '7b15f900-7b70-43a7-8cfa-c270e38e704e',
            name: 'Cellar Other',
        };
        store.listActiveManualWines.mockResolvedValue([
            manualWine,
            other,
        ]);

        const first = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                q: 'ＣELLAR',
                sort: 'name',
                direction: 'asc',
                limit: '1',
            },
        }));
        const cursor = JSON.parse(first.body).meta.nextCursor;
        const second = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: {
                q: 'cellar',
                sort: 'name',
                direction: 'asc',
                limit: '1',
                cursor,
            },
        }));

        expect(second.statusCode).toBe(200);
        expect(JSON.parse(second.body).data.items).toHaveLength(1);
    });

    it.each([
        '',
        'not-a-cursor',
        '%%%invalid-base64url%%%',
        'a'.repeat(2_049),
    ])('rejects malformed cursor %s', async cursor => {
        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
            queryStringParameters: { cursor },
        }));

        expect(errorCode(response)).toBe('INVALID_CURSOR');
        expect(store.listActiveManualWines).not.toHaveBeenCalled();
    });

    it('creates a manual wine for the authenticated subject without requesting assessment', async () => {
        store.createManualWine.mockResolvedValue(manualWine);

        const response = await handler(apiEvent({
            routeKey: 'POST /v1/manual-wines',
            body: JSON.stringify({
                name: 'Cellar Example',
                vintage: 'NV',
                description: 'Rich red fruit.',
            }),
        }));

        expect(response.statusCode).toBe(201);
        expect(store.createManualWine).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            manualWineId,
            name: 'Cellar Example',
            vintage: 'NV',
            description: 'Rich red fruit.',
            identity: 'cellar example\u0000NV',
            sourceHash: manualWine.sourceHash,
        });
        expect(assessmentReadStore.getHighestCompletedAssessment)
            .not.toHaveBeenCalled();
        expect(JSON.parse(response.body).data).toMatchObject({
            id: manualWineId,
            latestAssessment: null,
            freshness: {
                status: 'unassessed',
                currentPalateProfileVersion: 4,
            },
        });
    });

    it.each(['region', 'country', 'grape', 'alcohol', 'userId'])(
        'rejects unsupported create field %s',
        async field => {
            const response = await handler(apiEvent({
                routeKey: 'POST /v1/manual-wines',
                body: JSON.stringify({
                    name: 'Cellar Example',
                    vintage: 'NV',
                    description: '',
                    [field]: 'not-allowed',
                }),
            }));

            expect(errorCode(response)).toBe('INVALID_REQUEST');
            expect(store.createManualWine).not.toHaveBeenCalled();
        },
    );

    it('returns the duplicate identity conflict safely', async () => {
        const conflict = new Error('raw identity key');
        conflict.name = 'ManualWineAlreadyExistsError';
        store.createManualWine.mockRejectedValue(conflict);

        const response = await handler(apiEvent({
            routeKey: 'POST /v1/manual-wines',
            body: JSON.stringify({
                name: 'Cellar Example',
                vintage: 'NV',
                description: '',
            }),
        }));

        expect(response.statusCode).toBe(409);
        expect(errorCode(response)).toBe('MANUAL_WINE_ALREADY_EXISTS');
        expect(response.body).not.toContain('raw identity');
    });

    it('does not create a wine when response freshness cannot be read', async () => {
        store.getCurrentPalateProfileVersion.mockRejectedValue(
            new Error('profile read failed'),
        );
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const response = await handler(apiEvent({
            routeKey: 'POST /v1/manual-wines',
            body: JSON.stringify({
                name: 'Cellar Example',
                vintage: 'NV',
                description: '',
            }),
        }));

        expect(errorCode(response)).toBe('INTERNAL_ERROR');
        expect(store.createManualWine).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('gets an active wine by the literal API Gateway UUID parameter', async () => {
        store.getManualWineById.mockResolvedValue(manualWine);

        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines/{manualWineId}',
            manualWineId,
        }));

        expect(store.getManualWineById).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            manualWineId,
        });
        expect(response.statusCode).toBe(200);
    });

    it('does not decode item path parameters a second time', async () => {
        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines/{manualWineId}',
            manualWineId: '%66fbd54ef-0c8e-49c7-a98e-e6703c08410e',
        }));

        expect(errorCode(response)).toBe('INVALID_REQUEST');
        expect(store.getManualWineById).not.toHaveBeenCalled();
    });

    it.each([
        [undefined, 404, 'MANUAL_WINE_NOT_FOUND'],
        [{
            ...manualWine,
            status: 'deleted',
            isActive: false,
            deletedAt: '2026-07-23T11:00:00.000Z',
        }, 410, 'MANUAL_WINE_DELETED'],
    ])('maps missing or deleted item state safely', async (
        stored,
        statusCode,
        code,
    ) => {
        store.getManualWineById.mockResolvedValue(stored);

        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines/{manualWineId}',
            manualWineId,
        }));

        expect(response.statusCode).toBe(statusCode);
        expect(errorCode(response)).toBe(code);
    });

    it('patches only description and recalculates source freshness', async () => {
        const previousAssessment = {
            status: 'completed',
            assessmentInputKey: 'assessment-key',
            sourceKey,
            assessmentVersion: 2,
            palateProfileVersion: 4,
            sourceHash: manualWine.sourceHash,
            completedAt: '2026-07-23T10:30:00.000Z',
            assessment: {
                fit: 'good',
                confidence: 'medium',
                highlight: false,
                headline: 'A match',
                summary: 'Likely suitable.',
                reasoningMode: 'description_only',
                reasons: ['Description evidence.'],
                cautions: [],
                evidence: [{
                    type: 'direct',
                    source: 'wine.description',
                    text: 'Rich red fruit.',
                }],
                assumptions: [],
                palateAlignment: {
                    fruit: 'positive',
                    texture: 'neutral',
                    oakAndDevelopment: 'unknown',
                    structure: 'neutral',
                    overall: 'good',
                },
                styleProfile: {
                    body: 'medium',
                    fruitRipeness: 'ripe',
                    fruitCharacter: ['red_fruit'],
                    texture: [],
                    oakInfluence: 'unknown',
                    tannin: 'unknown',
                    acidity: 'unknown',
                    development: 'unknown',
                    styleTags: [],
                },
            },
        };
        const updated = {
            ...manualWine,
            description: 'Updated description.',
            updatedAt: '2026-07-23T11:00:00.000Z',
            sourceHash: createManualWineSourceHash({
                name: manualWine.name,
                vintage: manualWine.vintage,
                description: 'Updated description.',
            }),
        };
        store.getManualWineById.mockResolvedValue(manualWine);
        store.updateManualWineDescription.mockResolvedValue(updated);
        assessmentReadStore.getHighestCompletedAssessment
            .mockResolvedValue(previousAssessment);

        const response = await handler(apiEvent({
            routeKey: 'PATCH /v1/manual-wines/{manualWineId}',
            manualWineId,
            body: JSON.stringify({
                description: 'Updated description.',
            }),
        }));

        expect(store.updateManualWineDescription).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            manualWineId,
            description: 'Updated description.',
            sourceHash: updated.sourceHash,
        });
        expect(JSON.parse(response.body).data.freshness.status)
            .toBe('source_changed');
    });

    it('rejects identity changes through PATCH', async () => {
        const response = await handler(apiEvent({
            routeKey: 'PATCH /v1/manual-wines/{manualWineId}',
            manualWineId,
            body: JSON.stringify({
                name: 'Different',
                vintage: '2020',
                description: 'Updated.',
            }),
        }));

        expect(errorCode(response)).toBe('INVALID_REQUEST');
        expect(store.getManualWineById).not.toHaveBeenCalled();
    });

    it('returns the idempotent soft-delete representation', async () => {
        store.softDeleteManualWine.mockResolvedValue({
            ...manualWine,
            status: 'deleted',
            isActive: false,
            deletedAt: '2026-07-23T11:00:00.000Z',
        });

        const response = await handler(apiEvent({
            routeKey: 'DELETE /v1/manual-wines/{manualWineId}',
            manualWineId,
        }));

        expectJsonResponse(response, 200, {
            data: {
                id: manualWineId,
                sourceKey,
                status: 'deleted',
                deletedAt: '2026-07-23T11:00:00.000Z',
            },
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('returns a safe unauthenticated response without state access', async () => {
        const event = apiEvent({
            routeKey: 'GET /v1/manual-wines',
        });
        delete event.requestContext.authorizer.jwt.claims.sub;

        const response = await handler(event);

        expect(errorCode(response)).toBe('UNAUTHENTICATED');
        expect(store.listActiveManualWines).not.toHaveBeenCalled();
    });

    it('returns a safe internal error without leaking dependency details', async () => {
        store.listActiveManualWines.mockRejectedValue(
            new Error('table and request details'),
        );
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const response = await handler(apiEvent({
            routeKey: 'GET /v1/manual-wines',
        }));

        expect(errorCode(response)).toBe('INTERNAL_ERROR');
        expect(response.body).not.toContain('table and request');
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to handle manual wine request',
            {
                requestId: 'request-123',
                errorName: 'Error',
            },
        );
        consoleError.mockRestore();
    });
});

const apiEvent = ({
    routeKey,
    manualWineId: pathId,
    body,
    queryStringParameters,
}) => ({
    routeKey,
    body,
    queryStringParameters,
    pathParameters: pathId
        ? { manualWineId: pathId }
        : undefined,
    requestContext: {
        requestId: 'request-123',
        http: {
            method: routeKey.split(' ')[0],
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

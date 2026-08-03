import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssessmentRequestsHandler } from '../../src/api/assessmentRequests.js';

const manualWineId = 'ffbd54ef-0c8e-49c7-a98e-e6703c08410e';
const manualSourceKey = `manual:${ manualWineId }`;
const retailerSourceKey = 'retailer:tws:wine:one';

const retailerWine = {
    pk: 'RETAILER#tws',
    sk: 'LISTING#wine:one',
    entityType: 'RetailerListing',
    gsi1pk: 'RETAILER#tws#CURRENT',
    gsi1sk: 'PRICE#000019.99#LISTING#wine:one',
    retailerId: 'tws',
    sourceKey: retailerSourceKey,
    id: 'wine:one',
    name: 'Retailer Wine',
    vintage: 2020,
    region: 'Bordeaux',
    grape: 'Merlot',
    alcohol: '13.5%',
    price: '19.99',
    description: 'Ripe fruit and polished tannins.',
    sourceHash: 'retailer-hash',
    isCurrent: true,
    firstSeenAt: '2026-08-01T10:00:00.000Z',
    lastSeenAt: '2026-08-03T10:00:00.000Z',
};

const manualWine = {
    userId: 'cognito-sub-123',
    id: manualWineId,
    sourceKey: manualSourceKey,
    source: { type: 'manual', key: manualSourceKey },
    name: 'Cellar Wine',
    vintage: '2019',
    description: 'Dark fruit and a velvety texture.',
    status: 'active',
    isActive: true,
    sourceHash: 'manual-hash',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    deletedAt: null,
};

describe('assessment requests API handler', () => {
    let palateProfileStore;
    let catalogueStore;
    let manualWineStore;
    let assessmentVersionStore;
    let assessmentQueue;
    let createId;
    let handler;

    beforeEach(() => {
        palateProfileStore = {
            getCurrentPalateProfile: vi.fn().mockResolvedValue({
                palateProfileVersion: 4,
                palateProfile: {},
            }),
        };
        catalogueStore = {
            getCurrentWine: vi.fn().mockResolvedValue(retailerWine),
        };
        manualWineStore = {
            getManualWineBySourceKey: vi.fn().mockResolvedValue(manualWine),
        };
        assessmentVersionStore = {
            allocateNextAssessmentVersions: vi.fn().mockImplementation(({ sourceKeys }) =>
                Promise.resolve(sourceKeys.map((sourceKey, index) => ({
                    sourceKey,
                    assessmentVersion: index + 3,
                })))
            ),
        };
        assessmentQueue = {
            enqueueAssessmentRequest: vi.fn().mockResolvedValue(undefined),
        };
        createId = vi.fn()
            .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
            .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
        handler = createAssessmentRequestsHandler({
            palateProfileStore,
            catalogueStore,
            manualWineStore,
            assessmentVersionStore,
            assessmentQueue,
            createId,
            now: () => '2026-08-03T12:00:00.000Z',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requires the Cognito subject before reading or changing any state', async () => {
        const response = await handler(apiEvent({ authenticated: false }));

        expect(response.statusCode).toBe(401);
        expect(responseBody(response)).toEqual({
            error: {
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required.',
            },
            meta: { requestId: 'api-request-123' },
        });
        expect(palateProfileStore.getCurrentPalateProfile).not.toHaveBeenCalled();
        expect(assessmentVersionStore.allocateNextAssessmentVersions).not.toHaveBeenCalled();
        expect(assessmentQueue.enqueueAssessmentRequest).not.toHaveBeenCalled();
    });

    it.each([
        ['missing body', null, 'INVALID_REQUEST'],
        ['malformed JSON', '{', 'INVALID_REQUEST'],
        ['unknown field', JSON.stringify({ sourceKeys: [retailerSourceKey], userId: 'other' }), 'INVALID_REQUEST'],
        ['non-array sourceKeys', JSON.stringify({ sourceKeys: retailerSourceKey }), 'VALIDATION_FAILED'],
        ['empty sourceKeys', JSON.stringify({ sourceKeys: [] }), 'VALIDATION_FAILED'],
        ['too many sourceKeys', JSON.stringify({
            sourceKeys: Array.from({ length: 26 }, (_, index) => `retailer:tws:wine-${ index }`),
        }), 'VALIDATION_FAILED'],
        ['duplicate sourceKeys', JSON.stringify({
            sourceKeys: [retailerSourceKey, retailerSourceKey],
        }), 'VALIDATION_FAILED'],
        ['invalid source syntax', JSON.stringify({ sourceKeys: ['retailer::wine-1'] }), 'VALIDATION_FAILED'],
    ])('rejects %s before reading or allocating', async (_label, body, code) => {
        const response = await handler(apiEvent({ body }));

        expect(response.statusCode).toBe(400);
        expect(responseBody(response).error.code).toBe(code);
        expect(palateProfileStore.getCurrentPalateProfile).not.toHaveBeenCalled();
        expect(assessmentVersionStore.allocateNextAssessmentVersions).not.toHaveBeenCalled();
        expect(assessmentQueue.enqueueAssessmentRequest).not.toHaveBeenCalled();
    });

    it('requires a current palate profile before resolving sources or allocating', async () => {
        palateProfileStore.getCurrentPalateProfile.mockResolvedValue(undefined);

        const response = await handler(apiEvent());

        expect(response.statusCode).toBe(404);
        expect(responseBody(response).error.code).toBe('PALATE_PROFILE_NOT_FOUND');
        expect(catalogueStore.getCurrentWine).not.toHaveBeenCalled();
        expect(assessmentVersionStore.allocateNextAssessmentVersions).not.toHaveBeenCalled();
    });

    it('reports the actual later missing source and allocates nothing', async () => {
        const missingSourceKey = 'retailer:tws:missing-wine';
        catalogueStore.getCurrentWine.mockImplementation(({ wineId }) =>
            Promise.resolve(wineId === 'wine:one' ? retailerWine : undefined)
        );

        const response = await handler(apiEvent({
            sourceKeys: [retailerSourceKey, missingSourceKey],
        }));

        expect(response.statusCode).toBe(404);
        expect(responseBody(response).error).toMatchObject({
            code: 'ASSESSMENT_SOURCE_NOT_FOUND',
            details: { sourceKeys: [missingSourceKey] },
        });
        expect(assessmentVersionStore.allocateNextAssessmentVersions).not.toHaveBeenCalled();
        expect(assessmentQueue.enqueueAssessmentRequest).not.toHaveBeenCalled();
    });

    it.each([
        ['noncurrent retailer', [retailerSourceKey], () => {
            catalogueStore.getCurrentWine.mockResolvedValue(undefined);
        }],
        ['deleted manual wine', [manualSourceKey], () => {
            manualWineStore.getManualWineBySourceKey.mockResolvedValue({
                ...manualWine,
                status: 'deleted',
                isActive: false,
            });
        }],
        ['foreign manual wine', [manualSourceKey], () => {
            manualWineStore.getManualWineBySourceKey.mockResolvedValue(undefined);
        }],
    ])('rejects an unavailable %s before allocation', async (_label, sourceKeys, arrange) => {
        arrange();

        const response = await handler(apiEvent({ sourceKeys }));

        expect(response.statusCode).toBe(404);
        expect(responseBody(response).error.code).toBe('ASSESSMENT_SOURCE_NOT_FOUND');
        expect(assessmentVersionStore.allocateNextAssessmentVersions).not.toHaveBeenCalled();
        expect(assessmentQueue.enqueueAssessmentRequest).not.toHaveBeenCalled();
    });

    it('accepts one retailer source with an opaque colon-containing wine ID', async () => {
        const response = await handler(apiEvent());

        expect(response.statusCode).toBe(202);
        expect(catalogueStore.getCurrentWine).toHaveBeenCalledWith({
            retailerId: 'tws',
            wineId: 'wine:one',
        });
        expect(assessmentVersionStore.allocateNextAssessmentVersions).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            sourceKeys: [retailerSourceKey],
        });
    });

    it('queues exact projected retailer and manual snapshots after one bulk allocation', async () => {
        const response = await handler(apiEvent({
            sourceKeys: [retailerSourceKey, manualSourceKey],
        }));

        expect(response.statusCode).toBe(202);
        expect(responseBody(response)).toEqual({
            data: {
                requests: [
                    {
                        sourceKey: retailerSourceKey,
                        requestId: '00000000-0000-4000-8000-000000000001',
                        assessmentVersion: 3,
                    },
                    {
                        sourceKey: manualSourceKey,
                        requestId: '00000000-0000-4000-8000-000000000002',
                        assessmentVersion: 4,
                    },
                ],
            },
            meta: { requestId: 'api-request-123' },
        });
        expect(assessmentVersionStore.allocateNextAssessmentVersions).toHaveBeenCalledTimes(1);
        expect(assessmentVersionStore.allocateNextAssessmentVersions).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            sourceKeys: [retailerSourceKey, manualSourceKey],
        });
        expect(manualWineStore.getManualWineBySourceKey).toHaveBeenCalledWith({
            userId: 'cognito-sub-123',
            sourceKey: manualSourceKey,
        });
        expect(assessmentQueue.enqueueAssessmentRequest).toHaveBeenNthCalledWith(1, {
            requestId: '00000000-0000-4000-8000-000000000001',
            source: { type: 'retailer', key: retailerSourceKey },
            wineSnapshot: {
                id: 'wine:one',
                region: 'Bordeaux',
                name: 'Retailer Wine',
                vintage: 2020,
                price: '19.99',
                grape: 'Merlot',
                alcohol: '13.5%',
                description: 'Ripe fruit and polished tannins.',
                sourceHash: 'retailer-hash',
            },
            sourceHash: 'retailer-hash',
            assessmentVersion: 3,
            requestedAt: '2026-08-03T12:00:00.000Z',
            userId: 'cognito-sub-123',
        });
        expect(assessmentQueue.enqueueAssessmentRequest).toHaveBeenNthCalledWith(2, {
            requestId: '00000000-0000-4000-8000-000000000002',
            source: { type: 'manual', key: manualSourceKey },
            wineSnapshot: {
                id: manualWineId,
                name: 'Cellar Wine',
                vintage: '2019',
                description: 'Dark fruit and a velvety texture.',
                sourceHash: 'manual-hash',
            },
            sourceHash: 'manual-hash',
            assessmentVersion: 4,
            requestedAt: '2026-08-03T12:00:00.000Z',
            userId: 'cognito-sub-123',
        });

        for (const [request] of assessmentQueue.enqueueAssessmentRequest.mock.calls) {
            expect(request.wineSnapshot).not.toHaveProperty('pk');
            expect(request.wineSnapshot).not.toHaveProperty('sk');
            expect(request.wineSnapshot).not.toHaveProperty('entityType');
            expect(request.wineSnapshot).not.toHaveProperty('userId');
            expect(request.wineSnapshot).not.toHaveProperty('status');
            expect(request.wineSnapshot).not.toHaveProperty('createdAt');
            expect(request.wineSnapshot).not.toHaveProperty('updatedAt');
            expect(Object.keys(request.wineSnapshot).some(key => key.startsWith('gsi')))
                .toBe(false);
        }
    });

    it('returns accurate ordered queued and notQueued details after all sends settle', async () => {
        const queueFailure = new Error('queue unavailable');
        assessmentQueue.enqueueAssessmentRequest
            .mockRejectedValueOnce(queueFailure)
            .mockResolvedValueOnce(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handler(apiEvent({
            sourceKeys: [retailerSourceKey, manualSourceKey],
        }));

        expect(response.statusCode).toBe(503);
        expect(responseBody(response).error).toEqual({
            code: 'ASSESSMENT_QUEUE_UNAVAILABLE',
            message: 'One or more assessment requests could not be queued.',
            details: {
                queued: [{
                    sourceKey: manualSourceKey,
                    requestId: '00000000-0000-4000-8000-000000000002',
                    assessmentVersion: 4,
                }],
                notQueued: [{
                    sourceKey: retailerSourceKey,
                    assessmentVersion: 3,
                }],
            },
        });
        expect(assessmentQueue.enqueueAssessmentRequest).toHaveBeenCalledTimes(2);
        expect(assessmentVersionStore.allocateNextAssessmentVersions).toHaveBeenCalledTimes(1);
    });

    it('reports every allocated item as not queued when every send fails', async () => {
        assessmentQueue.enqueueAssessmentRequest.mockRejectedValue(new Error('queue unavailable'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handler(apiEvent({
            sourceKeys: [retailerSourceKey, manualSourceKey],
        }));

        expect(response.statusCode).toBe(503);
        expect(responseBody(response).error.details).toEqual({
            queued: [],
            notQueued: [
                { sourceKey: retailerSourceKey, assessmentVersion: 3 },
                { sourceKey: manualSourceKey, assessmentVersion: 4 },
            ],
        });
        expect(assessmentQueue.enqueueAssessmentRequest).toHaveBeenCalledTimes(2);
    });

    it('returns a safe internal error for an unexpected dependency failure', async () => {
        palateProfileStore.getCurrentPalateProfile.mockRejectedValue(
            new Error('DynamoDB endpoint unavailable')
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await handler(apiEvent());

        expect(response.statusCode).toBe(500);
        expect(responseBody(response)).toEqual({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'The assessment request could not be completed.',
            },
            meta: { requestId: 'api-request-123' },
        });
        expect(response.body).not.toContain('DynamoDB');
    });
});

const apiEvent = ({
    authenticated = true,
    sourceKeys = [retailerSourceKey],
    body = JSON.stringify({ sourceKeys }),
} = {}) => ({
    routeKey: 'POST /v1/assessment-requests',
    body,
    requestContext: {
        requestId: 'api-request-123',
        authorizer: authenticated
            ? { jwt: { claims: { sub: 'cognito-sub-123' } } }
            : undefined,
    },
});

const responseBody = response => JSON.parse(response.body);

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createAssessmentHistoryHandler,
} from '../../src/api/assessmentHistory.js';

const RETAILER_SOURCE_1 = 'retailer:tws:wine-1';
const RETAILER_SOURCE_2 = 'retailer:tws:wine-2';
const RETAILER_SOURCE_3 = 'retailer:tws:wine-3';
const MANUAL_SOURCE_1 = 'manual:11111111-1111-4111-8111-111111111111';
const MANUAL_SOURCE_2 = 'manual:22222222-2222-4222-8222-222222222222';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('assessment history API', () => {
    it('groups by source, chooses the highest assessment version and exposes only public fields', async () => {
        const assessments = [
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                assessmentVersion: 1,
                assessmentInputKey: 'input-v1',
                completedAt: '2026-07-23T12:00:00.000Z',
                headline: 'Older assessment',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                assessmentVersion: 3,
                assessmentInputKey: 'input-v3',
                completedAt: '2026-07-23T10:00:00.000Z',
                headline: 'Highest version',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_2,
                assessmentVersion: 2,
                assessmentInputKey: 'input-other',
                completedAt: '2026-07-22T10:00:00.000Z',
            }),
            {
                ...completedAssessment({
                    sourceKey: RETAILER_SOURCE_1,
                    assessmentVersion: 4,
                    assessmentInputKey: 'not-completed',
                }),
                status: 'failed',
            },
        ];
        const historyStore = fakeHistoryStore({
            userAssessments: assessments,
            listings: {
                [RETAILER_SOURCE_1]: retailerListing({
                    sourceKey: RETAILER_SOURCE_1,
                    price: '26',
                }),
            },
        });
        const response = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines')
        );
        const body = parseBody(response);

        expect(response.statusCode).toBe(200);
        expect(body.data.items).toHaveLength(2);
        const first = body.data.items.find(item => item.sourceKey === RETAILER_SOURCE_1);
        const removed = body.data.items.find(item => item.sourceKey === RETAILER_SOURCE_2);

        expect(first).toMatchObject({
            sourceType: 'retailer',
            retailerId: 'tws',
            retailerLabel: 'The Wine Society',
            assessmentCount: 2,
            lastAssessedAt: '2026-07-23T12:00:00.000Z',
            wine: {
                availability: 'current_retailer',
                currentPrice: {
                    amount: '26.00',
                    currency: 'GBP',
                },
            },
            latestAssessment: {
                assessmentInputKey: 'input-v3',
                assessmentVersion: 3,
                headline: 'Highest version',
            },
        });
        expect(removed.wine).toMatchObject({
            availability: 'removed_retailer',
            currentPrice: null,
        });
        expect(JSON.stringify(body)).not.toContain('snapshotPrice');
        expect(JSON.stringify(body)).not.toContain('source-hash');
        expect(JSON.stringify(body)).not.toContain('gpt-private');
        expect(JSON.stringify(body)).not.toContain('rawProviderResponse');
    });

    it('searches identity only and applies canonical source, availability, assessment and freshness filters', async () => {
        const assessments = [
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                name: 'Château Exemple',
                vintage: '2020',
                fit: 'strong',
                confidence: 'high',
                highlight: true,
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_2,
                name: 'Other Estate',
                vintage: '2018',
                fit: 'poor',
                confidence: 'low',
                highlight: false,
                headline: 'Chateau 2020 appears only in assessment prose',
            }),
        ];
        const historyStore = fakeHistoryStore({
            userAssessments: assessments,
            profileVersion: 4,
            listings: {
                [RETAILER_SOURCE_1]: retailerListing({
                    sourceKey: RETAILER_SOURCE_1,
                    name: 'Château Exemple',
                    vintage: '2020',
                    sourceHash: 'source-hash',
                }),
                [RETAILER_SOURCE_2]: retailerListing({
                    sourceKey: RETAILER_SOURCE_2,
                    name: 'Other Estate',
                    vintage: '2018',
                    sourceHash: 'changed-hash',
                    isCurrent: false,
                }),
            },
        });
        const response = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    q: 'chateau exemple 2020',
                    sourceType: 'retailer',
                    availability: 'current_retailer',
                    fit: 'strong',
                    confidence: 'high',
                    highlight: 'true',
                    freshness: 'current',
                },
            })
        );
        const body = parseBody(response);

        expect(response.statusCode).toBe(200);
        expect(body.data.items.map(item => item.sourceKey)).toEqual([
            RETAILER_SOURCE_1,
        ]);

        const proseSearch = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    q: 'appears only in assessment prose',
                },
            })
        );

        expect(parseBody(proseSearch).data.items).toEqual([]);

        const fitAscending = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sort: 'fit',
                    direction: 'asc',
                },
            })
        );
        const confidenceDescending = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sort: 'confidence',
                    direction: 'desc',
                },
            })
        );

        expect(parseBody(fitAscending).data.items.map(item => item.latestAssessment.fit))
            .toEqual(['poor', 'strong']);
        expect(
            parseBody(confidenceDescending).data.items
                .map(item => item.latestAssessment.confidence)
        ).toEqual(['high', 'low']);
    });

    it('returns stable opaque load-more cursors bound to the current sort and filters', async () => {
        const assessments = [
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                name: 'Alpha',
                assessmentInputKey: 'alpha',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_2,
                name: 'Bravo',
                assessmentInputKey: 'bravo',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_3,
                name: 'Charlie',
                assessmentInputKey: 'charlie',
            }),
        ];
        const historyStore = fakeHistoryStore({
            userAssessments: assessments,
            listings: Object.fromEntries(assessments.map(assessment => [
                assessment.sourceKey,
                retailerListing({
                    sourceKey: assessment.sourceKey,
                    name: assessment.wineSnapshot.name,
                }),
            ])),
        });
        const firstResponse = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sort: 'name',
                    direction: 'asc',
                    limit: '2',
                },
            })
        );
        const firstBody = parseBody(firstResponse);

        expect(firstBody.data.items.map(item => item.wine.name))
            .toEqual(['Alpha', 'Bravo']);
        expect(firstBody.meta.nextCursor).toEqual(expect.any(String));

        const secondResponse = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sort: 'name',
                    direction: 'asc',
                    limit: '2',
                    cursor: firstBody.meta.nextCursor,
                },
            })
        );
        const secondBody = parseBody(secondResponse);

        expect(secondBody.data.items.map(item => item.wine.name))
            .toEqual(['Charlie']);
        expect(secondBody.meta.nextCursor).toBeNull();

        const mismatchedResponse = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sort: 'confidence',
                    direction: 'asc',
                    limit: '2',
                    cursor: firstBody.meta.nextCursor,
                },
            })
        );

        expect(mismatchedResponse.statusCode).toBe(400);
        expect(parseBody(mismatchedResponse).error.code).toBe('INVALID_CURSOR');
    });

    it('distinguishes active and deleted manual sources through the injected user-scoped read boundary', async () => {
        const assessments = [
            completedAssessment({
                sourceKey: MANUAL_SOURCE_1,
                sourceType: 'manual',
                name: 'Active cellar wine',
                vintage: 'NV',
            }),
            completedAssessment({
                sourceKey: MANUAL_SOURCE_2,
                sourceType: 'manual',
                name: 'Deleted cellar wine',
                vintage: '2019',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_3,
                name: 'Removed retailer wine',
            }),
        ];
        const historyStore = fakeHistoryStore({
            userAssessments: assessments,
            listings: {
                [RETAILER_SOURCE_3]: retailerListing({
                    sourceKey: RETAILER_SOURCE_3,
                    name: 'Removed retailer wine',
                    isCurrent: false,
                }),
            },
        });
        const getManualWineBySourceKey = vi.fn(({ userId, sourceKey }) => ({
            userId,
            sourceKey,
            name: sourceKey === MANUAL_SOURCE_1
                ? 'Active cellar wine'
                : 'Deleted cellar wine',
            vintage: sourceKey === MANUAL_SOURCE_1 ? 'NV' : '2019',
            description: 'Manual description',
            sourceHash: 'source-hash',
            isActive: sourceKey === MANUAL_SOURCE_1,
            deletedAt: sourceKey === MANUAL_SOURCE_1
                ? null
                : '2026-07-23T13:00:00.000Z',
        }));
        const response = await handlerFor({
            historyStore,
            getManualWineBySourceKey,
        })(request('GET /v1/assessed-wines', {
            queryStringParameters: {
                sourceType: 'manual',
                sort: 'name',
                direction: 'asc',
            },
        }));
        const body = parseBody(response);

        expect(body.data.items.map(item => ({
            sourceKey: item.sourceKey,
            retailerId: item.retailerId,
            retailerLabel: item.retailerLabel,
            availability: item.wine.availability,
            currentPrice: item.wine.currentPrice,
        }))).toEqual([
            {
                sourceKey: MANUAL_SOURCE_1,
                retailerId: null,
                retailerLabel: null,
                availability: 'active_manual',
                currentPrice: null,
            },
            {
                sourceKey: MANUAL_SOURCE_2,
                retailerId: null,
                retailerLabel: null,
                availability: 'deleted_manual',
                currentPrice: null,
            },
        ]);
        expect(getManualWineBySourceKey).toHaveBeenCalledWith({
            userId: 'authenticated-user',
            sourceKey: MANUAL_SOURCE_1,
        });
        expect(getManualWineBySourceKey).toHaveBeenCalledWith({
            userId: 'authenticated-user',
            sourceKey: MANUAL_SOURCE_2,
        });

        const deletedManualResponse = await handlerFor({
            historyStore,
            getManualWineBySourceKey,
        })(request('GET /v1/assessed-wines', {
            queryStringParameters: {
                availability: 'deleted_manual',
            },
        }));
        const removedRetailerResponse = await handlerFor({
            historyStore,
            getManualWineBySourceKey,
        })(request('GET /v1/assessed-wines', {
            queryStringParameters: {
                availability: 'removed_retailer',
            },
        }));

        expect(parseBody(deletedManualResponse).data.items.map(item => item.sourceKey))
            .toEqual([MANUAL_SOURCE_2]);
        expect(parseBody(removedRetailerResponse).data.items.map(item => item.sourceKey))
            .toEqual([RETAILER_SOURCE_3]);
    });

    it('does not infer deleted manual state when the injected record is unavailable', async () => {
        const historyStore = fakeHistoryStore({
            userAssessments: [
                completedAssessment({
                    sourceKey: MANUAL_SOURCE_1,
                    sourceType: 'manual',
                }),
                completedAssessment({
                    sourceKey: RETAILER_SOURCE_1,
                    sourceType: 'retailer',
                }),
            ],
            listings: {
                [RETAILER_SOURCE_1]: retailerListing({
                    sourceKey: RETAILER_SOURCE_1,
                }),
            },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const handler = handlerFor({
            historyStore,
            getManualWineBySourceKey: vi.fn().mockResolvedValue(undefined),
        });
        const retailerResponse = await handler(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    sourceType: 'retailer',
                },
            })
        );
        const response = await handler(request('GET /v1/assessed-wines'));

        expect(parseBody(retailerResponse).data.items.map(item => item.sourceKey))
            .toEqual([RETAILER_SOURCE_1]);
        expect(response.statusCode).toBe(500);
        expect(parseBody(response)).toEqual({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'The request could not be completed.',
            },
            meta: {
                requestId: 'request-123',
            },
        });
    });

    it('derives profile and source freshness independently from current source state', async () => {
        const assessments = [
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                palateProfileVersion: 3,
                sourceHash: 'old-hash',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_2,
                palateProfileVersion: 4,
                sourceHash: 'old-hash',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_3,
                palateProfileVersion: 3,
                sourceHash: 'same-hash',
            }),
        ];
        const historyStore = fakeHistoryStore({
            userAssessments: assessments,
            profileVersion: 4,
            listings: {
                [RETAILER_SOURCE_1]: retailerListing({
                    sourceKey: RETAILER_SOURCE_1,
                    sourceHash: 'new-hash',
                }),
                [RETAILER_SOURCE_2]: retailerListing({
                    sourceKey: RETAILER_SOURCE_2,
                    sourceHash: 'new-hash',
                }),
                [RETAILER_SOURCE_3]: retailerListing({
                    sourceKey: RETAILER_SOURCE_3,
                    sourceHash: 'same-hash',
                    isCurrent: false,
                }),
            },
        });
        const response = await handlerFor({ historyStore })(
            request('GET /v1/assessed-wines')
        );
        const itemsBySource = Object.fromEntries(
            parseBody(response).data.items.map(item => [item.sourceKey, item])
        );

        expect(itemsBySource[RETAILER_SOURCE_1].freshness).toEqual({
            status: 'palate_profile_and_source_changed',
            isCurrent: false,
            profileChanged: true,
            sourceChanged: true,
            assessedPalateProfileVersion: 3,
            currentPalateProfileVersion: 4,
        });
        expect(itemsBySource[RETAILER_SOURCE_2].freshness.status)
            .toBe('source_changed');
        expect(itemsBySource[RETAILER_SOURCE_3]).toMatchObject({
            wine: {
                availability: 'removed_retailer',
            },
            freshness: {
                status: 'palate_profile_changed',
            },
        });
    });

    it('returns assessed-wine summary, ordered history and exact assessment version routes', async () => {
        const sourceAssessments = [
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                assessmentVersion: 1,
                assessmentInputKey: 'input-1',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                assessmentVersion: 4,
                assessmentInputKey: 'input-4',
            }),
            completedAssessment({
                sourceKey: RETAILER_SOURCE_1,
                assessmentVersion: 2,
                assessmentInputKey: 'input-2',
            }),
        ];
        const historyStore = fakeHistoryStore({
            sourceAssessments: {
                [RETAILER_SOURCE_1]: sourceAssessments,
            },
            listings: {
                [RETAILER_SOURCE_1]: retailerListing({
                    sourceKey: RETAILER_SOURCE_1,
                }),
            },
        });
        const handler = handlerFor({ historyStore });

        const summaryResponse = await handler(
            request('GET /v1/assessed-wines/{sourceKey}', {
                pathParameters: {
                    sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                },
            })
        );
        expect(parseBody(summaryResponse).data).toMatchObject({
            sourceKey: RETAILER_SOURCE_1,
            assessmentCount: 3,
            latestAssessment: {
                assessmentVersion: 4,
            },
        });

        const listResponse = await handler(
            request('GET /v1/assessed-wines/{sourceKey}/assessments', {
                pathParameters: {
                    sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                },
                queryStringParameters: {
                    limit: '2',
                },
            })
        );
        const listBody = parseBody(listResponse);
        expect(listBody.data.items.map(item => item.assessmentVersion))
            .toEqual([4, 2]);
        expect(listBody.meta.nextCursor).toEqual(expect.any(String));

        const nextListResponse = await handler(
            request('GET /v1/assessed-wines/{sourceKey}/assessments', {
                pathParameters: {
                    sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                },
                queryStringParameters: {
                    limit: '2',
                    cursor: listBody.meta.nextCursor,
                },
            })
        );
        expect(parseBody(nextListResponse)).toMatchObject({
            data: {
                items: [{
                    assessmentVersion: 1,
                }],
            },
            meta: {
                nextCursor: null,
            },
        });

        const exactResponse = await handler(
            request(
                'GET /v1/assessed-wines/{sourceKey}/assessments/{assessmentVersion}',
                {
                    pathParameters: {
                        sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                        assessmentVersion: '2',
                    },
                }
            )
        );
        expect(parseBody(exactResponse).data).toMatchObject({
            sourceKey: RETAILER_SOURCE_1,
            assessmentVersion: 2,
            assessmentInputKey: 'input-2',
        });
    });

    it('returns route-specific not-found responses without leaking another user history', async () => {
        const historyStore = fakeHistoryStore();
        const handler = handlerFor({ historyStore });

        const summaryResponse = await handler(
            request('GET /v1/assessed-wines/{sourceKey}', {
                pathParameters: {
                    sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                },
            })
        );
        const assessmentResponse = await handler(
            request(
                'GET /v1/assessed-wines/{sourceKey}/assessments/{assessmentVersion}',
                {
                    pathParameters: {
                        sourceKey: encodeURIComponent(RETAILER_SOURCE_1),
                        assessmentVersion: '9',
                    },
                }
            )
        );

        expect(summaryResponse.statusCode).toBe(404);
        expect(parseBody(summaryResponse).error.code).toBe('ASSESSED_WINE_NOT_FOUND');
        expect(assessmentResponse.statusCode).toBe(404);
        expect(parseBody(assessmentResponse).error.code).toBe('ASSESSMENT_NOT_FOUND');
        expect(historyStore.listCompletedAssessmentsBySource).toHaveBeenCalledWith({
            userId: 'authenticated-user',
            sourceKey: RETAILER_SOURCE_1,
        });
    });

    it('uses Cognito sub only and rejects client-supplied user scope', async () => {
        const historyStore = fakeHistoryStore();
        const handler = handlerFor({ historyStore });
        const unauthenticated = await handler({
            ...request('GET /v1/assessed-wines'),
            requestContext: {
                requestId: 'request-unauthenticated',
                authorizer: {
                    jwt: {
                        claims: {},
                    },
                },
            },
        });
        const clientScoped = await handler(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    userId: 'attacker',
                },
                headers: {
                    'x-user-id': 'attacker',
                },
            })
        );

        expect(unauthenticated.statusCode).toBe(401);
        expect(clientScoped.statusCode).toBe(400);
        expect(parseBody(clientScoped).error.code).toBe('INVALID_REQUEST');
        expect(historyStore.listCompletedAssessmentsByUser).not.toHaveBeenCalled();
    });

    it('returns safe validation, cursor and unexpected-error envelopes', async () => {
        const serviceError = new Error('secret DynamoDB detail');
        serviceError.name = 'ProvisionedThroughputExceededException';
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const validationHandler = handlerFor({
            historyStore: fakeHistoryStore(),
        });

        const invalidFilter = await validationHandler(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    confidence: 'certain',
                },
            })
        );
        const invalidCursor = await validationHandler(
            request('GET /v1/assessed-wines', {
                queryStringParameters: {
                    cursor: 'not-json',
                },
            })
        );
        const failingStore = fakeHistoryStore();
        failingStore.listCompletedAssessmentsByUser.mockRejectedValue(serviceError);
        const unexpected = await handlerFor({
            historyStore: failingStore,
        })(request('GET /v1/assessed-wines'));

        expect(invalidFilter.statusCode).toBe(400);
        expect(parseBody(invalidFilter)).toMatchObject({
            error: {
                code: 'VALIDATION_FAILED',
                details: [{
                    field: 'confidence',
                }],
            },
            meta: {
                requestId: 'request-123',
            },
        });
        expect(invalidCursor.statusCode).toBe(400);
        expect(parseBody(invalidCursor).error.code).toBe('INVALID_CURSOR');
        expect(unexpected.statusCode).toBe(500);
        expect(unexpected.body).not.toContain('secret DynamoDB detail');
        expect(console.error).toHaveBeenCalledWith(
            'Assessment history request failed requestId=request-123 errorName=ProvisionedThroughputExceededException'
        );
    });
});

const handlerFor = ({
    historyStore,
    getManualWineBySourceKey = vi.fn(),
}) => createAssessmentHistoryHandler({
    historyStore,
    getManualWineBySourceKey,
});

const fakeHistoryStore = ({
    userAssessments = [],
    sourceAssessments = {},
    listings = {},
    profileVersion = 4,
} = {}) => ({
    listCompletedAssessmentsByUser: vi.fn().mockResolvedValue(userAssessments),
    listCompletedAssessmentsBySource: vi.fn(({ sourceKey }) =>
        Promise.resolve(sourceAssessments[sourceKey] ?? [])
    ),
    getCurrentPalateProfileVersion: vi.fn().mockResolvedValue(profileVersion),
    getRetailerWineBySourceKey: vi.fn(({ sourceKey }) =>
        Promise.resolve(listings[sourceKey])
    ),
});

const request = (routeKey, overrides = {}) => ({
    routeKey,
    requestContext: {
        requestId: 'request-123',
        authorizer: {
            jwt: {
                claims: {
                    sub: 'authenticated-user',
                },
            },
        },
    },
    ...overrides,
});

const parseBody = response => JSON.parse(response.body);

const completedAssessment = ({
    sourceKey = RETAILER_SOURCE_1,
    sourceType = 'retailer',
    assessmentVersion = 1,
    assessmentInputKey = `${ sourceKey }-${ assessmentVersion }`,
    palateProfileVersion = 4,
    sourceHash = 'source-hash',
    completedAt = `2026-07-${ String(20 + assessmentVersion).padStart(2, '0') }T10:00:00.000Z`,
    name = `Wine ${ sourceKey.at(-1) }`,
    vintage = '2020',
    fit = 'good',
    confidence = 'medium_high',
    highlight = false,
    headline = 'Public headline',
} = {}) => ({
    pk: 'USER#authenticated-user',
    sk: `ASSESSMENT#${ assessmentInputKey }`,
    entityType: 'Assessment',
    userId: 'authenticated-user',
    assessmentInputKey,
    source: {
        type: sourceType,
        key: sourceKey,
    },
    sourceKey,
    wineSnapshot: {
        id: sourceKey.split(':').at(-1),
        name,
        vintage,
        region: sourceType === 'retailer' ? 'Bordeaux' : null,
        grape: sourceType === 'retailer' ? 'Merlot' : null,
        alcohol: sourceType === 'retailer' ? '13.5%' : null,
        description: 'Identity description',
        price: '777.77',
        snapshotPrice: '777.77',
        sourceHash,
    },
    sourceHash,
    palateProfileVersion,
    assessmentVersion,
    status: 'completed',
    model: 'gpt-private',
    rawProviderResponse: {
        secret: true,
    },
    assessment: {
        fit,
        confidence,
        highlight,
        headline,
        summary: 'Public summary',
        reasoningMode: 'metadata_plus_description',
        reasons: ['Public reason'],
        cautions: ['Public caution'],
        evidence: [{
            type: 'direct',
            source: 'wine.description',
            text: 'Public evidence',
        }],
        assumptions: [],
        palateAlignment: {
            fruit: 'positive',
            texture: 'positive',
            oakAndDevelopment: 'mixed',
            structure: 'neutral',
            overall: fit,
        },
        styleProfile: {
            body: 'medium_plus',
            fruitRipeness: 'ripe',
            fruitCharacter: ['black_fruit'],
            texture: ['polished'],
            oakInfluence: 'moderate',
            tannin: 'moderate_plus',
            acidity: 'balanced',
            development: 'ready_to_drink',
            styleTags: ['fruit_forward'],
        },
    },
    createdAt: completedAt,
    completedAt,
    gsi1pk: 'USER#authenticated-user#ASSESSMENTS',
    gsi1sk: `CREATED#${ completedAt }#ASSESSMENT#${ assessmentInputKey }`,
    gsi2pk: `USER#authenticated-user#SOURCE#${ sourceKey }`,
    gsi2sk: `CREATED#${ completedAt }#ASSESSMENT#${ assessmentInputKey }`,
});

const retailerListing = ({
    sourceKey,
    name = `Wine ${ sourceKey.at(-1) }`,
    vintage = '2020',
    sourceHash = 'source-hash',
    isCurrent = true,
    price = '25.50',
}) => ({
    entityType: 'RetailerListing',
    sourceKey,
    id: sourceKey.split(':').at(-1),
    name,
    vintage,
    region: 'Bordeaux',
    grape: 'Merlot',
    alcohol: '13.5%',
    description: 'Current retailer description',
    sourceHash,
    isCurrent,
    price,
});

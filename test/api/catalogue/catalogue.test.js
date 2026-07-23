import { describe, expect, it, vi } from 'vitest';
import { createCatalogueHandler } from '../../../src/api/catalogue/catalogue.js';

const requestContext = {
    requestId: 'api-request-123',
    authorizer: {
        jwt: {
            claims: {
                sub: 'authenticated-user',
            },
        },
    },
};

const createWine = ({
    id,
    name,
    vintage = 2020,
    price = '25.50',
    region = 'Bordeaux',
    grape = 'Merlot',
    sourceHash = `hash-${ id }`,
    firstSeenAt = '2026-07-20T10:00:00.000Z',
    lastSeenAt = '2026-07-23T10:00:00.000Z',
    retailerId = 'tws',
    isCurrent = true,
    sourceKey = `retailer:${ retailerId }:${ id }`,
} = {}) => ({
    id,
    sourceKey,
    retailerId,
    name,
    vintage,
    price,
    region,
    grape,
    alcohol: '13.5%',
    description: 'Ripe fruit and polished tannins.',
    sourceHash,
    firstSeenAt,
    lastSeenAt,
    isCurrent,
});

const createAssessment = ({
    sourceKey,
    assessmentVersion = 2,
    palateProfileVersion = 3,
    sourceHash,
    fit = 'good',
    confidence = 'medium_high',
    highlight = true,
    completedAt = '2026-07-23T11:00:00.000Z',
} = {}) => ({
    assessmentInputKey: `assessment-${ sourceKey }-${ assessmentVersion }`,
    sourceKey,
    assessmentVersion,
    palateProfileVersion,
    sourceHash,
    wineSnapshot: {
        price: '19.99',
    },
    status: 'completed',
    completedAt,
    assessment: {
        fit,
        confidence,
        highlight,
        headline: 'Ripe and polished',
        summary: 'A likely match.',
        reasoningMode: 'metadata_plus_description',
        reasons: ['Ripe fruit profile.'],
        cautions: [],
        evidence: [{
            type: 'direct',
            source: 'wine.description',
            text: 'The description identifies ripe fruit.',
        }],
        assumptions: [],
        palateAlignment: {
            fruit: 'positive',
            texture: 'positive',
            oakAndDevelopment: 'neutral',
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
            styleTags: ['fruit_forward', 'polished'],
        },
    },
});

const createFakeStore = ({
    wines = [],
    assessments = {},
    currentPalateProfileVersion = 3,
} = {}) => ({
    listCurrentWines: vi.fn().mockResolvedValue(wines),
    getCurrentWine: vi.fn().mockImplementation(({ retailerId, wineId }) =>
        Promise.resolve(wines.find(wine =>
            wine.retailerId === retailerId
            && wine.id === wineId
            && wine.isCurrent === true
        ))
    ),
    getLatestCompletedAssessments: vi.fn().mockImplementation(({ sourceKeys }) =>
        Promise.resolve(new Map(
            sourceKeys
                .filter(sourceKey => assessments[sourceKey])
                .map(sourceKey => [sourceKey, assessments[sourceKey]])
        ))
    ),
    getLatestCompletedAssessment: vi.fn().mockImplementation(({ sourceKey }) =>
        Promise.resolve(assessments[sourceKey])
    ),
    getCurrentPalateProfileVersion: vi.fn()
        .mockResolvedValue(currentPalateProfileVersion),
});

const listEvent = queryStringParameters => ({
    routeKey: 'GET /v1/catalogue/wines',
    requestContext,
    queryStringParameters,
});

const detailEvent = sourceKey => ({
    routeKey: 'GET /v1/catalogue/wines/{sourceKey}',
    requestContext,
    pathParameters: {
        sourceKey,
    },
});

const parseBody = response => JSON.parse(response.body);

describe('catalogue API', () => {
    it('uses the Cognito subject for assessment reads and rejects client-supplied user identity', async () => {
        const wine = createWine({ id: 'wine-1', name: 'Wine One' });
        const store = createFakeStore({ wines: [wine] });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const response = await handler(listEvent());

        expect(response.statusCode).toBe(200);
        expect(store.getCurrentPalateProfileVersion)
            .toHaveBeenCalledWith('authenticated-user');
        expect(store.getLatestCompletedAssessments).toHaveBeenCalledWith({
            userId: 'authenticated-user',
            sourceKeys: ['retailer:tws:wine-1'],
        });

        const rejectedResponse = await handler(listEvent({
            userId: 'different-user',
        }));

        expect(rejectedResponse.statusCode).toBe(400);
        expect(parseBody(rejectedResponse).error).toMatchObject({
            code: 'INVALID_REQUEST',
            details: [{
                field: 'query.userId',
                reason: 'is not supported',
            }],
        });
    });

    it('returns only current retailer rows with current price, canonical assessment values and freshness', async () => {
        const currentWine = createWine({
            id: 'wine-1',
            name: 'Current Wine',
            price: '25.5',
            sourceHash: 'current-source-hash',
        });
        const assessment = createAssessment({
            sourceKey: currentWine.sourceKey,
            sourceHash: 'older-source-hash',
            fit: 'strong',
            confidence: 'high',
        });
        const store = createFakeStore({
            wines: [
                currentWine,
                createWine({
                    id: 'removed',
                    name: 'Removed Wine',
                    isCurrent: false,
                }),
                createWine({
                    id: 'manual-1',
                    name: 'Manual Wine',
                    retailerId: undefined,
                    sourceKey: 'manual:manual-1',
                }),
            ],
            assessments: {
                [currentWine.sourceKey]: assessment,
            },
        });

        const response = await createCatalogueHandler({
            catalogueStore: store,
        })(listEvent());
        const body = parseBody(response);

        expect(response.statusCode).toBe(200);
        expect(body.meta).toEqual({
            requestId: 'api-request-123',
            nextCursor: null,
        });
        expect(body.data.items).toHaveLength(1);
        expect(body.data.items[0]).toMatchObject({
            sourceKey: 'retailer:tws:wine-1',
            retailerId: 'tws',
            retailerLabel: 'The Wine Society',
            retailerWineId: 'wine-1',
            currentPrice: {
                amount: '25.50',
                currency: 'GBP',
            },
            firstSeenAt: '2026-07-20T10:00:00.000Z',
            lastSeenAt: '2026-07-23T10:00:00.000Z',
            latestAssessment: {
                assessmentVersion: 2,
                fit: 'strong',
                confidence: 'high',
                highlight: true,
            },
            freshness: {
                status: 'source_changed',
                isCurrent: false,
                profileChanged: false,
                sourceChanged: true,
                assessedPalateProfileVersion: 3,
                currentPalateProfileVersion: 3,
            },
        });
        expect(response.body).not.toContain('19.99');
        expect(response.body).not.toContain('sourceHash');
    });

    it('keeps missing assessments safe and returns the complete unassessed freshness state', async () => {
        const wine = createWine({ id: 'wine-1', name: 'Wine One' });
        const store = createFakeStore({
            wines: [wine],
            currentPalateProfileVersion: null,
        });

        const response = await createCatalogueHandler({
            catalogueStore: store,
        })(listEvent());

        expect(parseBody(response).data.items[0]).toMatchObject({
            latestAssessment: null,
            freshness: {
                status: 'unassessed',
                isCurrent: false,
                profileChanged: false,
                sourceChanged: false,
                assessedPalateProfileVersion: null,
                currentPalateProfileVersion: null,
            },
        });
    });

    it('searches identity fields deterministically without searching assessment prose', async () => {
        const napa = createWine({
            id: 'napa-1',
            name: 'Estate Cabernet',
            vintage: 2021,
            region: 'Napa Valley',
        });
        const bordeaux = createWine({
            id: 'bordeaux-1',
            name: 'Chateau Example',
            vintage: 2019,
            region: 'Bordeaux',
        });
        const store = createFakeStore({
            wines: [napa, bordeaux],
            assessments: {
                [bordeaux.sourceKey]: {
                    ...createAssessment({
                        sourceKey: bordeaux.sourceKey,
                        sourceHash: bordeaux.sourceHash,
                    }),
                    assessment: {
                        ...createAssessment({
                            sourceKey: bordeaux.sourceKey,
                            sourceHash: bordeaux.sourceHash,
                        }).assessment,
                        summary: 'Napa is mentioned only in assessment prose.',
                    },
                },
            },
        });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const regionResponse = await handler(listEvent({ q: 'napa valley' }));
        expect(parseBody(regionResponse).data.items.map(item => item.sourceKey))
            .toEqual([napa.sourceKey]);

        const vintageResponse = await handler(listEvent({ q: '2019' }));
        expect(parseBody(vintageResponse).data.items.map(item => item.sourceKey))
            .toEqual([bordeaux.sourceKey]);

        const retailerResponse = await handler(listEvent({ q: 'wine society' }));
        expect(parseBody(retailerResponse).data.items).toHaveLength(2);
    });

    it('applies canonical fit, confidence and freshness filters without losing explicitly requested unassessed wines', async () => {
        const good = createWine({ id: 'good', name: 'Good Wine' });
        const poor = createWine({ id: 'poor', name: 'Poor Wine' });
        const unassessed = createWine({ id: 'unassessed', name: 'Unassessed Wine' });
        const store = createFakeStore({
            wines: [good, poor, unassessed],
            assessments: {
                [good.sourceKey]: createAssessment({
                    sourceKey: good.sourceKey,
                    sourceHash: good.sourceHash,
                    fit: 'good',
                    confidence: 'medium_high',
                }),
                [poor.sourceKey]: createAssessment({
                    sourceKey: poor.sourceKey,
                    sourceHash: 'old-hash',
                    fit: 'poor',
                    confidence: 'low',
                }),
            },
        });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const response = await handler(listEvent({
            fit: 'good',
            confidence: 'medium_high',
            freshness: 'current,unassessed',
        }));

        expect(parseBody(response).data.items.map(item => item.sourceKey)).toEqual([
            good.sourceKey,
            unassessed.sourceKey,
        ]);
    });

    it('applies approved identity, inclusive price and highlight filters', async () => {
        const highlighted = createWine({
            id: 'highlighted',
            name: 'Highlighted Wine',
            price: '20.00',
            region: 'North Bordeaux',
            grape: 'Cabernet and Merlot',
        });
        const unhighlighted = createWine({
            id: 'unhighlighted',
            name: 'Unhighlighted Wine',
            price: '30.00',
            region: 'Rioja',
            grape: 'Tempranillo',
        });
        const unassessed = createWine({
            id: 'unassessed',
            name: 'Unassessed Wine',
            price: '20.00',
            region: 'Bordeaux',
            grape: 'Merlot',
        });
        const store = createFakeStore({
            wines: [highlighted, unhighlighted, unassessed],
            assessments: {
                [highlighted.sourceKey]: createAssessment({
                    sourceKey: highlighted.sourceKey,
                    sourceHash: highlighted.sourceHash,
                    highlight: true,
                }),
                [unhighlighted.sourceKey]: createAssessment({
                    sourceKey: unhighlighted.sourceKey,
                    sourceHash: unhighlighted.sourceHash,
                    highlight: false,
                }),
            },
        });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const filteredResponse = await handler(listEvent({
            region: ' bordeaux ',
            grape: 'MERLOT',
            minPrice: '020',
            maxPrice: '020.00',
            highlight: 'true',
        }));

        expect(parseBody(filteredResponse).data.items.map(item => item.sourceKey))
            .toEqual([highlighted.sourceKey]);

        const unhighlightedResponse = await handler(listEvent({
            highlight: 'false',
        }));

        expect(
            parseBody(unhighlightedResponse).data.items.map(item => item.sourceKey)
        ).toEqual([unhighlighted.sourceKey]);
    });

    it.each([
        {
            query: { region: ' ' },
            field: 'region',
        },
        {
            query: { grape: 'x'.repeat(121) },
            field: 'grape',
        },
        {
            query: { minPrice: '-1' },
            field: 'minPrice',
        },
        {
            query: { maxPrice: '1.234' },
            field: 'maxPrice',
        },
        {
            query: { highlight: 'yes' },
            field: 'highlight',
        },
        {
            query: { minPrice: '30', maxPrice: '20' },
            field: 'minPrice',
        },
        {
            query: {
                minPrice: '9007199254740993',
                maxPrice: '9007199254740992',
            },
            field: 'minPrice',
        },
    ])('rejects invalid approved filter values for $field', async ({
        query,
        field,
    }) => {
        const response = await createCatalogueHandler({
            catalogueStore: createFakeStore(),
        })(listEvent(query));

        expect(response.statusCode).toBe(400);
        expect(parseBody(response).error).toMatchObject({
            code: 'VALIDATION_FAILED',
            details: [{
                field: `query.${ field }`,
            }],
        });
    });

    it.each([
        {
            query: { sort: 'fit', direction: 'asc' },
            expected: ['poor', 'strong', 'unassessed'],
        },
        {
            query: { sort: 'fit', direction: 'desc' },
            expected: ['strong', 'poor', 'unassessed'],
        },
        {
            query: { sort: 'confidence', direction: 'desc' },
            expected: ['strong', 'poor', 'unassessed'],
        },
    ])('sorts canonical values with unassessed wines last for $query', async ({
        query,
        expected,
    }) => {
        const wines = [
            createWine({ id: 'poor', name: 'Poor Wine' }),
            createWine({ id: 'unassessed', name: 'Unassessed Wine' }),
            createWine({ id: 'strong', name: 'Strong Wine' }),
        ];
        const store = createFakeStore({
            wines,
            assessments: {
                [wines[0].sourceKey]: createAssessment({
                    sourceKey: wines[0].sourceKey,
                    sourceHash: wines[0].sourceHash,
                    fit: 'poor',
                    confidence: 'low',
                }),
                [wines[2].sourceKey]: createAssessment({
                    sourceKey: wines[2].sourceKey,
                    sourceHash: wines[2].sourceHash,
                    fit: 'strong',
                    confidence: 'high',
                }),
            },
        });

        const response = await createCatalogueHandler({
            catalogueStore: store,
        })(listEvent(query));

        expect(parseBody(response).data.items.map(item => item.retailerWineId))
            .toEqual(expected);
    });

    it('uses stable source-key cursor pagination and rejects a cursor bound to different filters', async () => {
        const wines = [
            createWine({ id: 'wine-b', name: 'Same Name' }),
            createWine({ id: 'wine-a', name: 'Same Name' }),
            createWine({ id: 'wine-c', name: 'Zeta Name' }),
        ];
        const store = createFakeStore({ wines });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const firstResponse = await handler(listEvent({
            sort: 'name',
            direction: 'asc',
            region: 'bordeaux',
            limit: '2',
        }));
        const firstBody = parseBody(firstResponse);

        expect(firstBody.data.items.map(item => item.retailerWineId)).toEqual([
            'wine-a',
            'wine-b',
        ]);
        expect(firstBody.meta.nextCursor).toEqual(expect.any(String));

        const secondResponse = await handler(listEvent({
            sort: 'name',
            direction: 'asc',
            region: 'bordeaux',
            limit: '2',
            cursor: firstBody.meta.nextCursor,
        }));

        expect(parseBody(secondResponse)).toMatchObject({
            data: {
                items: [{
                    retailerWineId: 'wine-c',
                }],
            },
            meta: {
                nextCursor: null,
            },
        });

        const mismatchedFilterResponse = await handler(listEvent({
            sort: 'name',
            direction: 'asc',
            region: 'rioja',
            limit: '2',
            cursor: firstBody.meta.nextCursor,
        }));

        expect(mismatchedFilterResponse.statusCode).toBe(400);
        expect(parseBody(mismatchedFilterResponse).error.code)
            .toBe('INVALID_CURSOR');

        for (const changedFilter of [
            { grape: 'cabernet' },
            { minPrice: '20' },
            { maxPrice: '30' },
            { highlight: 'false' },
        ]) {
            const mismatchedApprovedFilterResponse = await handler(listEvent({
                sort: 'name',
                direction: 'asc',
                region: 'bordeaux',
                limit: '2',
                cursor: firstBody.meta.nextCursor,
                ...changedFilter,
            }));

            expect(mismatchedApprovedFilterResponse.statusCode).toBe(400);
            expect(parseBody(mismatchedApprovedFilterResponse).error.code)
                .toBe('INVALID_CURSOR');
        }

        const invalidResponse = await handler(listEvent({
            sort: 'price',
            direction: 'asc',
            region: 'bordeaux',
            limit: '2',
            cursor: firstBody.meta.nextCursor,
        }));

        expect(invalidResponse.statusCode).toBe(400);
        expect(parseBody(invalidResponse).error.code).toBe('INVALID_CURSOR');
    });

    it('continues from the encoded cursor position when the anchor wine is removed', async () => {
        const wines = [
            createWine({ id: 'wine-a', name: 'Alpha Name' }),
            createWine({ id: 'wine-b', name: 'Bravo Name' }),
            createWine({ id: 'wine-c', name: 'Charlie Name' }),
        ];
        const store = createFakeStore({ wines });
        const handler = createCatalogueHandler({ catalogueStore: store });

        const firstResponse = await handler(listEvent({
            sort: 'name',
            direction: 'asc',
            limit: '2',
        }));
        const firstBody = parseBody(firstResponse);

        expect(firstBody.data.items.map(item => item.retailerWineId)).toEqual([
            'wine-a',
            'wine-b',
        ]);

        store.listCurrentWines.mockResolvedValue([
            wines[0],
            wines[2],
        ]);

        const secondResponse = await handler(listEvent({
            sort: 'name',
            direction: 'asc',
            limit: '2',
            cursor: firstBody.meta.nextCursor,
        }));

        expect(secondResponse.statusCode).toBe(200);
        expect(parseBody(secondResponse)).toMatchObject({
            data: {
                items: [{
                    retailerWineId: 'wine-c',
                }],
            },
            meta: {
                nextCursor: null,
            },
        });
    });

    it('defaults recently added sorting to descending firstSeenAt', async () => {
        const wines = [
            createWine({
                id: 'older',
                name: 'Older Wine',
                firstSeenAt: '2026-07-20T10:00:00.000Z',
            }),
            createWine({
                id: 'newer',
                name: 'Newer Wine',
                firstSeenAt: '2026-07-22T10:00:00.000Z',
            }),
        ];

        const response = await createCatalogueHandler({
            catalogueStore: createFakeStore({ wines }),
        })(listEvent({ sort: 'first_seen' }));

        expect(parseBody(response).data.items.map(item => item.retailerWineId))
            .toEqual(['newer', 'older']);
    });

    it('sorts prices numerically using the current WineStock price', async () => {
        const wines = [
            createWine({
                id: 'expensive',
                name: 'Expensive Wine',
                price: '100.00',
            }),
            createWine({
                id: 'affordable',
                name: 'Affordable Wine',
                price: '25.50',
            }),
        ];

        const response = await createCatalogueHandler({
            catalogueStore: createFakeStore({ wines }),
        })(listEvent({
            sort: 'price',
            direction: 'asc',
        }));

        expect(parseBody(response).data.items.map(item => item.retailerWineId))
            .toEqual(['affordable', 'expensive']);
    });

    it('returns detail with assessment-history link metadata', async () => {
        const wine = createWine({ id: 'wine-1', name: 'Wine One' });
        const store = createFakeStore({
            wines: [wine],
            assessments: {
                [wine.sourceKey]: createAssessment({
                    sourceKey: wine.sourceKey,
                    sourceHash: wine.sourceHash,
                }),
            },
        });

        const response = await createCatalogueHandler({
            catalogueStore: store,
        })(detailEvent(wine.sourceKey));

        expect(response.statusCode).toBe(200);
        expect(parseBody(response)).toMatchObject({
            data: {
                sourceKey: wine.sourceKey,
                assessmentHistory: {
                    href: '/v1/assessed-wines/retailer%3Atws%3Awine-1/assessments',
                },
            },
            meta: {
                requestId: 'api-request-123',
            },
        });
    });

    it.each([
        {
            sourceKey: 'manual:manual-1',
            statusCode: 400,
            code: 'INVALID_REQUEST',
        },
        {
            sourceKey: 'retailer:tws:missing',
            statusCode: 404,
            code: 'CATALOGUE_WINE_NOT_FOUND',
        },
    ])('returns the contract error for source key $sourceKey', async ({
        sourceKey,
        statusCode,
        code,
    }) => {
        const response = await createCatalogueHandler({
            catalogueStore: createFakeStore(),
        })(detailEvent(sourceKey));

        expect(response.statusCode).toBe(statusCode);
        expect(parseBody(response).error.code).toBe(code);
    });

    it('rejects undocumented filters and invalid enum values', async () => {
        const handler = createCatalogueHandler({
            catalogueStore: createFakeStore(),
        });

        const undocumentedResponse = await handler(listEvent({
            country: 'France',
        }));
        expect(parseBody(undocumentedResponse).error).toMatchObject({
            code: 'INVALID_REQUEST',
            details: [{
                field: 'query.country',
                reason: 'is not supported',
            }],
        });

        const invalidEnumResponse = await handler(listEvent({
            fit: 'excellent',
        }));
        expect(parseBody(invalidEnumResponse).error).toMatchObject({
            code: 'VALIDATION_FAILED',
            details: [{
                field: 'query.fit',
                reason: 'contains an unsupported value',
            }],
        });

        const emptyCursorResponse = await handler(listEvent({
            cursor: '',
        }));
        expect(parseBody(emptyCursorResponse).error.code).toBe('INVALID_CURSOR');
    });

    it('returns a safe internal error without exposing dependency details', async () => {
        const store = createFakeStore();
        store.listCurrentWines.mockRejectedValue(
            new Error('Sensitive DynamoDB detail'),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await createCatalogueHandler({
            catalogueStore: store,
        })(listEvent());

        expect(response.statusCode).toBe(500);
        expect(parseBody(response)).toEqual({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'The request could not be completed.',
            },
            meta: {
                requestId: 'api-request-123',
            },
        });
        expect(response.body).not.toContain('Sensitive DynamoDB detail');
        expect(consoleError).toHaveBeenCalledWith(
            'Catalogue request failed requestId=api-request-123 errorName=Error',
        );

        consoleError.mockRestore();
    });

    it('returns the safe authentication error without consulting state', async () => {
        const store = createFakeStore();
        const handler = createCatalogueHandler({ catalogueStore: store });

        const response = await handler({
            ...listEvent(),
            requestContext: {
                requestId: 'api-request-123',
            },
        });

        expect(response.statusCode).toBe(401);
        expect(parseBody(response).error.code).toBe('UNAUTHENTICATED');
        expect(store.listCurrentWines).not.toHaveBeenCalled();
    });
});

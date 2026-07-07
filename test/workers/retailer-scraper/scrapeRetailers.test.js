import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrapeRetailers } from '@grapescrape/retailer-scraper/scrapeRetailers.js';

const currentWine = {
    id: 'new-wine',
    name: 'New Wine',
    vintage: 2020,
    region: 'Bordeaux',
    price: '25.00',
    sourceHash: 'hash-new'
};

const previousWine = {
    id: 'missing-wine',
    name: 'Missing Wine',
    vintage: 2019,
    region: 'Rioja',
    price: '19.00',
    sourceHash: 'hash-missing'
};

const createContext = ({ previous = [], current = [currentWine] } = {}) => {
    const store = {
        listCurrentWinesByRetailer: vi.fn().mockResolvedValue(previous),
        upsertWineListings: vi.fn().mockResolvedValue(undefined),
        markListingsMissing: vi.fn().mockResolvedValue(undefined)
    };
    const notifier = {
        notify: vi.fn().mockResolvedValue(undefined)
    };
    const queue = {
        enqueueAssessmentRequests: vi.fn().mockResolvedValue(undefined)
    };
    const getCurrentWines = vi.fn().mockResolvedValue(current);

    return { store, notifier, queue, getCurrentWines };
};

describe('scrapeRetailers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('validates required dependencies', async () => {
        const context = createContext();

        await expect(scrapeRetailers({ ...context, store: undefined, retailerId: 'tws' }))
            .rejects.toThrow('Store is required');
        await expect(scrapeRetailers({ ...context, notifier: undefined, retailerId: 'tws' }))
            .rejects.toThrow('Notifier is required');
        await expect(scrapeRetailers({ ...context, queue: undefined, retailerId: 'tws' }))
            .rejects.toThrow('Queue is required');
    });

    it('writes current listings to the store', async () => {
        const context = createContext({ previous: [currentWine], current: [currentWine] });

        const result = await scrapeRetailers({ retailerId: 'tws', ...context });

        expect(context.getCurrentWines).toHaveBeenCalledWith('tws');
        expect(context.store.listCurrentWinesByRetailer).toHaveBeenCalledWith('tws');
        expect(context.store.upsertWineListings).toHaveBeenCalledWith({
            retailerId: 'tws',
            wines: [currentWine]
        });
        expect(result).toEqual({ total: 1, added: 0, removed: 0 });
    });

    it('marks removed listings as missing', async () => {
        const context = createContext({ previous: [previousWine], current: [currentWine] });

        await scrapeRetailers({ retailerId: 'tws', ...context });

        expect(context.store.markListingsMissing).toHaveBeenCalledWith({
            retailerId: 'tws',
            wines: [previousWine]
        });
    });

    it('sends notifications only when listings changed', async () => {
        const unchangedContext = createContext({ previous: [currentWine], current: [currentWine] });
        await scrapeRetailers({ retailerId: 'tws', ...unchangedContext });

        expect(unchangedContext.notifier.notify).not.toHaveBeenCalled();

        const changedContext = createContext({ previous: [previousWine], current: [currentWine] });
        await scrapeRetailers({ retailerId: 'tws', ...changedContext });

        expect(changedContext.notifier.notify).toHaveBeenCalledWith({
            added: [currentWine],
            removed: [previousWine],
            current: [currentWine]
        });
    });

    it('enqueues assessment requests only for added wines', async () => {
        const unchangedContext = createContext({ previous: [currentWine], current: [currentWine] });
        await scrapeRetailers({ retailerId: 'tws', ...unchangedContext });

        expect(unchangedContext.queue.enqueueAssessmentRequests).not.toHaveBeenCalled();

        const addedContext = createContext({ previous: [], current: [currentWine] });
        await scrapeRetailers({ retailerId: 'tws', ...addedContext });

        expect(addedContext.queue.enqueueAssessmentRequests).toHaveBeenCalledWith([
            {
                requestId: expect.any(String),
                source: { type: 'retailer', key: 'retailer:tws:new-wine' },
                wine: currentWine,
                sourceHash: 'hash-new',
                assessmentVersion: 1,
                requestedAt: '2026-01-02T03:04:05.000Z'
            }
        ]);
    });

    it('fails clearly when the retailer scrape returns no results', async () => {
        const context = createContext({ current: [] });

        await expect(scrapeRetailers({ retailerId: 'tws', ...context }))
            .rejects.toThrow('No results found');
    });
});

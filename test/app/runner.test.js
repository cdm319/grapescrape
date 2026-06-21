import { describe, expect, it, vi } from 'vitest';
import { run } from '../../src/app/runner.js';

const createStore = previous => ({
    load: vi.fn().mockResolvedValue(previous),
    save: vi.fn().mockResolvedValue(undefined),
});

const createNotifier = () => ({
    notify: vi.fn().mockResolvedValue(undefined),
});

const createAssessmentEnricher = highlightedMatches => ({
    assessWines: vi.fn().mockResolvedValue(highlightedMatches),
});

describe('run', () => {
    it('should load previous wines, save current wines, and return summary counts', async () => {
        const previous = [
            { id: 1, name: 'Existing wine', price: '20.00' },
        ];

        const current = [
            { id: 1, name: 'Existing wine', price: '20.00' },
            { id: 2, name: 'New wine', price: '25.00' },
        ];

        const store = createStore(previous);
        const notifier = createNotifier();

        const result = await run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue(current),
        });

        expect(store.load).toHaveBeenCalledOnce();
        expect(store.save).toHaveBeenCalledWith(current);
        expect(notifier.notify).toHaveBeenCalledWith({
            added: [{ id: 2, name: 'New wine', price: '25.00' }],
            removed: [],
            current,
            highlightedMatches: [],
        });

        expect(result).toEqual({
            total: 2,
            added: 1,
            removed: 0,
            highlightedMatches: 0,
        });
    });

    it('should sort current wines by price before saving and notifying', async () => {
        const current = [
            { id: 2, name: 'Expensive wine', price: '30.00' },
            { id: 1, name: 'Cheap wine', price: '15.00' },
        ];

        const store = createStore([]);
        const notifier = createNotifier();

        await run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue(current),
        });

        const sortedCurrent = [
            { id: 1, name: 'Cheap wine', price: '15.00' },
            { id: 2, name: 'Expensive wine', price: '30.00' },
        ];

        expect(store.save).toHaveBeenCalledWith(sortedCurrent);
        expect(notifier.notify).toHaveBeenCalledWith({
            added: sortedCurrent,
            removed: [],
            current: sortedCurrent,
            highlightedMatches: [],
        });
    });

    it('should not notify when there are no added, removed, or highlighted wines', async () => {
        const previous = [
            { id: 1, name: 'Existing wine', price: '20.00' },
        ];

        const current = [
            { id: 1, name: 'Existing wine', price: '20.00' },
        ];

        const store = createStore(previous);
        const notifier = createNotifier();

        const result = await run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue(current),
        });

        expect(store.save).toHaveBeenCalledWith(current);
        expect(notifier.notify).not.toHaveBeenCalled();

        expect(result).toEqual({
            total: 1,
            added: 0,
            removed: 0,
            highlightedMatches: 0,
        });
    });

    it('passes all current wines to the assessment enricher', async () => {
        const current = [
            { id: 1, name: 'Existing wine', price: '20.00' },
            { id: 2, name: 'New wine', price: '25.00' },
        ];

        const store = createStore([{ id: 1, name: 'Existing wine', price: '20.00' }]);
        const notifier = createNotifier();
        const assessmentEnricher = createAssessmentEnricher([]);

        await run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue(current),
            assessmentEnricher,
        });

        expect(assessmentEnricher.assessWines).toHaveBeenCalledWith(current);
    });

    it('notifies when highlighted matches are found without added or removed wines', async () => {
        const current = [
            { id: 1, name: 'Existing wine', price: '20.00' },
        ];
        const highlightedMatches = [
            {
                wine: current[0],
                assessment: { fit: 'strong', confidence: 'high', highlight: true },
            },
        ];

        const store = createStore(current);
        const notifier = createNotifier();
        const assessmentEnricher = createAssessmentEnricher(highlightedMatches);

        const result = await run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue(current),
            assessmentEnricher,
        });

        expect(notifier.notify).toHaveBeenCalledWith({
            added: [],
            removed: [],
            current,
            highlightedMatches,
        });
        expect(result.highlightedMatches).toBe(1);
    });

    it('should throw when no wines are returned', async () => {
        const store = createStore([]);
        const notifier = createNotifier();

        await expect(run({
            store,
            notifier,
            getWines: vi.fn().mockResolvedValue([]),
        })).rejects.toThrow('No results found');

        expect(store.load).not.toHaveBeenCalled();
        expect(store.save).not.toHaveBeenCalled();
        expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('throws when store is missing', async () => {
        const notifier = createNotifier();

        await expect(run({
            notifier,
            getWines: vi.fn().mockResolvedValue([
                { id: 1, name: 'Wine', price: '20.00' },
            ]),
        })).rejects.toThrow('Store is not defined');
    });

    it('throws when notifier is missing', async () => {
        const store = createStore([]);

        await expect(run({
            store,
            getWines: vi.fn().mockResolvedValue([
                { id: 1, name: 'Wine', price: '20.00' },
            ]),
        })).rejects.toThrow('Notifier is not defined');
    });
});

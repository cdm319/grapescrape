import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleNotifier } from '../../src/notify/consoleNotifier.js';

describe('consoleNotifier', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'table').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs added wines when added wines are present', async () => {
        const added = [
            { id: 1, name: 'New Wine' },
        ];

        await consoleNotifier.notify({
            added,
            removed: [],
            current: [],
        });

        expect(console.log).toHaveBeenCalledWith('\nNew Wines: ');
        expect(console.table).toHaveBeenCalledWith(added);
    });

    it('logs removed wines when removed wines are present', async () => {
        const removed = [
            { id: 1, name: 'Removed Wine' },
        ];

        await consoleNotifier.notify({
            added: [],
            removed,
            current: [],
        });

        expect(console.log).toHaveBeenCalledWith('\nRemoved Wines: ');
        expect(console.table).toHaveBeenCalledWith(removed);
    });

    it('logs current wines when current wines are present', async () => {
        const current = [
            { id: 1, name: 'Current Wine' },
        ];

        await consoleNotifier.notify({
            added: [],
            removed: [],
            current,
        });

        expect(console.log).toHaveBeenCalledWith('\nCurrent Wines: ');
        expect(console.table).toHaveBeenCalledWith(current);
    });

    it('does not log anything when all arrays are empty', async () => {
        await consoleNotifier.notify({
            added: [],
            removed: [],
            current: [],
        });

        expect(console.log).not.toHaveBeenCalled();
        expect(console.table).not.toHaveBeenCalled();
    });
});
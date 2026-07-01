import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../src/assess/concurrency.js';

describe('mapWithConcurrency', () => {
    it('maps all items in order', async () => {
        const result = await mapWithConcurrency([1, 2, 3], 2, async value => value * 2);

        expect(result).toEqual([2, 4, 6]);
    });

    it('does not run more than the configured number of tasks concurrently', async () => {
        let active = 0;
        let maxActive = 0;

        await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
            active += 1;
            maxActive = Math.max(maxActive, active);

            await new Promise(resolve => setTimeout(resolve, 1));

            active -= 1;
            return value;
        });

        expect(maxActive).toBe(2);
    });
});

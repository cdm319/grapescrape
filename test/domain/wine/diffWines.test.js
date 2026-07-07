import { describe, expect, it } from 'vitest';
import { diffWines } from '@grapescrape/domain/wine/diffWines';

describe('diffWines', () => {
    it('identifies added wines', () => {
        const result = diffWines(
            [{ id: 'existing', name: 'Existing Wine' }],
            [
                { id: 'existing', name: 'Existing Wine' },
                { id: 'added', name: 'Added Wine' }
            ]
        );

        expect(result.added).toEqual([{ id: 'added', name: 'Added Wine' }]);
        expect(result.removed).toEqual([]);
    });

    it('identifies removed wines', () => {
        const result = diffWines(
            [
                { id: 'kept', name: 'Kept Wine' },
                { id: 'removed', name: 'Removed Wine' }
            ],
            [{ id: 'kept', name: 'Kept Wine' }]
        );

        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([{ id: 'removed', name: 'Removed Wine' }]);
    });

    it('does not treat unchanged listings as added or removed', () => {
        const previous = [{ id: 'same', name: 'Original Name' }];
        const current = [{ id: 'same', name: 'Updated Name' }];

        expect(diffWines(previous, current)).toEqual({
            added: [],
            removed: []
        });
    });
});

import { describe, expect, it } from 'vitest';
import { createS3Store } from '../../src/store/s3Store.js';

describe('createS3Store', () => {
    it('throws when bucket is missing', () => {
        expect(() => createS3Store({ bucket: '', key: 'state/results.json' }))
            .toThrow('Bucket and key are required');
    });

    it('throws when key is missing', () => {
        expect(() => createS3Store({ bucket: 'grapescrape-state', key: '' }))
            .toThrow('Bucket and key are required');
    });
});

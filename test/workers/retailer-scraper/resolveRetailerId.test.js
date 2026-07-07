import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveRetailerId } from "../../../src/workers/retailer-scraper/resolveRetailerId.js";

describe('resolveRetailerId', () => {
    it('uses the retailer ID from the event payload', () => {
        assert.equal(resolveRetailerId({ retailerId: 'tws' }, {}), 'tws');
    });

    it('prefers the event retailer ID over the environment fallback', () => {
        assert.equal(resolveRetailerId({ retailerId: 'tws' }, { RETAILER_ID: 'ignored' }), 'tws');
    });

    it('uses RETAILER_ID from the environment when the event does not provide one', () => {
        assert.equal(resolveRetailerId({}, { RETAILER_ID: 'tws' }), 'tws');
    });

    it('falls back to tws when the event and environment are empty', () => {
        assert.equal(resolveRetailerId({}, {}), 'tws');
    });

    it('ignores blank event and environment values', () => {
        assert.equal(resolveRetailerId({ retailerId: '   ' }, { RETAILER_ID: '' }), 'tws');
    });

    it('rejects unsupported retailer IDs clearly', () => {
        assert.throws(
            () => resolveRetailerId({ retailerId: 'other-retailer' }, {}),
            /Unsupported retailer: other-retailer/
        );
    });
});

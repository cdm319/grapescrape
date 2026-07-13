import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createAssessmentInputKey } from '@grapescrape/domain/assessment/createAssessmentInputKey';

const keyInput = {
    userId: 'user-1',
    sourceKey: 'retailer:tws:wine-1',
    palateProfileVersion: 1,
    assessmentVersion: 2,
    sourceHash: 'source-hash-1',
};

describe('createAssessmentInputKey', () => {
    it('matches the CM-26 migrated assessment key contract', () => {
        const migratedKey = createHash('sha256')
            .update(JSON.stringify({
                userId: keyInput.userId,
                sourceKey: keyInput.sourceKey,
                palateProfileVersion: keyInput.palateProfileVersion,
                assessmentVersion: keyInput.assessmentVersion,
                sourceHash: keyInput.sourceHash,
            }))
            .digest('hex');

        expect(createAssessmentInputKey(keyInput)).toBe(migratedKey);
    });

    it.each([
        ['userId', 'user-2'],
        ['sourceKey', 'retailer:tws:wine-2'],
        ['palateProfileVersion', 2],
        ['assessmentVersion', 3],
        ['sourceHash', 'source-hash-2'],
    ])('changes when %s changes', (field, value) => {
        expect(createAssessmentInputKey({ ...keyInput, [field]: value }))
            .not.toBe(createAssessmentInputKey(keyInput));
    });
});

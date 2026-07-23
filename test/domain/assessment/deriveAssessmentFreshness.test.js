import { describe, expect, it } from 'vitest';
import { deriveAssessmentFreshness } from '@grapescrape/domain/assessment/deriveAssessmentFreshness';

const assessment = {
    palateProfileVersion: 3,
    sourceHash: 'source-hash-1',
};

describe('deriveAssessmentFreshness', () => {
    it('returns current when the assessment profile and source both match', () => {
        expect(deriveAssessmentFreshness({
            assessment,
            currentPalateProfileVersion: 3,
            currentSourceHash: 'source-hash-1',
        })).toEqual({
            status: 'current',
            isCurrent: true,
            profileChanged: false,
            sourceChanged: false,
            assessedPalateProfileVersion: 3,
            currentPalateProfileVersion: 3,
        });
    });

    it.each([
        {
            currentPalateProfileVersion: 4,
            currentSourceHash: 'source-hash-1',
            status: 'palate_profile_changed',
            profileChanged: true,
            sourceChanged: false,
        },
        {
            currentPalateProfileVersion: 3,
            currentSourceHash: 'source-hash-2',
            status: 'source_changed',
            profileChanged: false,
            sourceChanged: true,
        },
        {
            currentPalateProfileVersion: 4,
            currentSourceHash: 'source-hash-2',
            status: 'palate_profile_and_source_changed',
            profileChanged: true,
            sourceChanged: true,
        },
    ])('returns $status when current state differs', expected => {
        expect(deriveAssessmentFreshness({
            assessment,
            currentPalateProfileVersion: expected.currentPalateProfileVersion,
            currentSourceHash: expected.currentSourceHash,
        })).toEqual({
            status: expected.status,
            isCurrent: false,
            profileChanged: expected.profileChanged,
            sourceChanged: expected.sourceChanged,
            assessedPalateProfileVersion: 3,
            currentPalateProfileVersion: expected.currentPalateProfileVersion,
        });
    });

    it('returns the complete unassessed shape when there is no completed assessment', () => {
        expect(deriveAssessmentFreshness({
            assessment: null,
            currentPalateProfileVersion: 4,
            currentSourceHash: 'source-hash-1',
        })).toEqual({
            status: 'unassessed',
            isCurrent: false,
            profileChanged: false,
            sourceChanged: false,
            assessedPalateProfileVersion: null,
            currentPalateProfileVersion: 4,
        });
    });

    it('preserves a null current profile version for unassessed and assessed sources', () => {
        expect(deriveAssessmentFreshness({
            assessment: null,
            currentPalateProfileVersion: null,
            currentSourceHash: 'source-hash-1',
        }).currentPalateProfileVersion).toBeNull();

        expect(deriveAssessmentFreshness({
            assessment,
            currentPalateProfileVersion: null,
            currentSourceHash: 'source-hash-1',
        })).toMatchObject({
            status: 'palate_profile_changed',
            profileChanged: true,
            currentPalateProfileVersion: null,
        });
    });
});

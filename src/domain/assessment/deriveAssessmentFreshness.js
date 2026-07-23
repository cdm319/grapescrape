export const deriveAssessmentFreshness = ({
    assessment,
    currentPalateProfileVersion,
    currentSourceHash,
}) => {
    if (!assessment) {
        return {
            status: 'unassessed',
            isCurrent: false,
            profileChanged: false,
            sourceChanged: false,
            assessedPalateProfileVersion: null,
            currentPalateProfileVersion: currentPalateProfileVersion ?? null,
        };
    }

    const assessedPalateProfileVersion = assessment.palateProfileVersion;
    const profileChanged = assessedPalateProfileVersion !== (currentPalateProfileVersion ?? null);
    const sourceChanged = assessment.sourceHash !== currentSourceHash;

    return {
        status: getFreshnessStatus({ profileChanged, sourceChanged }),
        isCurrent: !profileChanged && !sourceChanged,
        profileChanged,
        sourceChanged,
        assessedPalateProfileVersion,
        currentPalateProfileVersion: currentPalateProfileVersion ?? null,
    };
};

const getFreshnessStatus = ({ profileChanged, sourceChanged }) => {
    if (profileChanged && sourceChanged) {
        return 'palate_profile_and_source_changed';
    }

    if (profileChanged) {
        return 'palate_profile_changed';
    }

    if (sourceChanged) {
        return 'source_changed';
    }

    return 'current';
};

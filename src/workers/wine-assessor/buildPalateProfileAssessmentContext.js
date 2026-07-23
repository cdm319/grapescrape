export const buildPalateProfileAssessmentContext = currentPalateProfile => {
    const palateProfileVersion = currentPalateProfile.palateProfileVersion
        ?? currentPalateProfile.version;
    const palateProfile = currentPalateProfile.palateProfile;
    const wineExamples = palateProfile?.wineExamples;

    if (!Array.isArray(wineExamples)) {
        return {
            palateProfileVersion,
            palateProfile,
        };
    }

    return {
        palateProfileVersion,
        palateProfile: {
            stylePreferences: palateProfile.stylePreferences,
            wineExamples: wineExamples.map(({
                name,
                vintage,
                sentiment,
                notes,
            }) => ({
                name,
                vintage,
                sentiment,
                notes,
            })),
        },
    };
};

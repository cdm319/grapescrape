export const projectPalateProfileForAssessment = currentPalateProfile => {
    const wineExamples = currentPalateProfile?.palateProfile?.wineExamples;

    if (!Array.isArray(wineExamples)) return currentPalateProfile;

    return {
        ...currentPalateProfile,
        palateProfile: {
            ...currentPalateProfile.palateProfile,
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

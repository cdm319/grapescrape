import { ASSESSMENT_VERSION, createAssessmentSourceHash, isCachedAssessmentValid, shouldHighlightAssessment } from "./assessmentCache.js";

export const createAssessmentEnricher = ({ store, provider, palateProfile, model, assessmentVersion = ASSESSMENT_VERSION } = {}) => {
    if (!store) throw new Error('Assessment store is required');
    if (!provider) throw new Error('Assessment provider is required');
    if (!palateProfile) throw new Error('Palate profile is required');
    if (!palateProfile.version) throw new Error('Palate profile version is required');

    return {
        async assessWines(wines) {
            if (!wines.length) return [];

            const cache = await store.load();
            const updatedCache = { ...cache };
            const highlightedMatches = [];

            for (const wine of wines) {
                const sourceHash = createAssessmentSourceHash(wine);
                const cached = updatedCache[wine.id];

                let entry;

                if (isCachedAssessmentValid({cached, sourceHash, palateProfileVersion: palateProfile.version, assessmentVersion })) {
                    entry = cached;
                } else {
                    try {
                        const assessment = await provider.assessWine({ wine, palateProfile });

                        entry = {
                            assessmentVersion,
                            palateProfileVersion: palateProfile.version,
                            sourceHash,
                            model,
                            wine,
                            createdAt: new Date().toISOString(),
                            assessment
                        };

                        updatedCache[wine.id] = entry;
                    } catch (error) {
                        console.error(`Error assessing wine ${wine.id}`, error);
                        continue;
                    }
                }

                if (shouldHighlightAssessment(entry.assessment)) {
                    highlightedMatches.push({
                        wine,
                        assessment: entry.assessment
                    });
                }
            }

            await store.save(updatedCache);

            return highlightedMatches;
        }
    };
};
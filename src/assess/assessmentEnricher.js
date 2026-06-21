import {
    ASSESSMENT_VERSION,
    createAssessmentSourceHash,
    isCachedAssessmentValid,
    shouldHighlightAssessment,
} from './assessmentCache.js';
import { mapWithConcurrency } from './concurrency.js';

export const createAssessmentEnricher = ({
    store,
    provider,
    palateProfile,
    model,
    assessmentVersion = ASSESSMENT_VERSION,
    maxAssessmentsPerRun = 20,
    assessmentConcurrency = 10,
    now = () => new Date().toISOString(),
    logger = console,
} = {}) => {
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
            const assessmentsToRun = [];

            for (const wine of wines) {
                const sourceHash = createAssessmentSourceHash(wine);
                const cached = updatedCache[wine.id];

                if (isCachedAssessmentValid({ cached, sourceHash, palateProfileVersion: palateProfile.version, assessmentVersion })) {
                    continue;
                }

                if (assessmentsToRun.length >= maxAssessmentsPerRun) {
                    logger.warn('Skipping assessment due to MAX_ASSESSMENTS_PER_RUN', {
                        wineId: wine.id,
                        maxAssessmentsPerRun,
                    });
                    continue;
                }

                assessmentsToRun.push({ wine, sourceHash });
            }

            logger.info('Running wine assessments', {
                currentWines: wines.length,
                assessmentsToRun: assessmentsToRun.length,
                assessmentConcurrency,
                maxAssessmentsPerRun,
            });

            const results = await mapWithConcurrency(
                assessmentsToRun,
                assessmentConcurrency,
                async ({ wine, sourceHash }) => {
                    try {
                        logger.info(`Sending wine ${wine.id} for assessment.`);

                        const assessment = await provider.assessWine({ wine, palateProfile });

                        return {
                            ok: true,
                            wine,
                            entry: {
                                assessmentVersion,
                                palateProfileVersion: palateProfile.version,
                                sourceHash,
                                model,
                                wine,
                                createdAt: now(),
                                assessment,
                            },
                        };
                    } catch (error) {
                        logger.error(`Error assessing wine ${wine.id}`, error);

                        return {
                            ok: false,
                            wine,
                            error,
                        };
                    }
                }
            );

            for (const result of results) {
                if (!result?.ok) continue;

                updatedCache[result.wine.id] = result.entry;

                if (shouldHighlightAssessment(result.entry.assessment)) {
                    highlightedMatches.push({
                        wine: result.entry.wine,
                        assessment: result.entry.assessment,
                    });
                }
            }

            await store.save(updatedCache);

            return highlightedMatches;
        }
    };
};

import { deriveAssessmentFreshness } from '@grapescrape/domain/assessment/deriveAssessmentFreshness';

export const presentManualWine = ({
    manualWine,
    latestAssessment,
    currentPalateProfileVersion,
}) => ({
    id: manualWine.id,
    sourceKey: manualWine.sourceKey,
    name: manualWine.name,
    vintage: manualWine.vintage,
    description: manualWine.description,
    status: manualWine.status,
    createdAt: manualWine.createdAt,
    updatedAt: manualWine.updatedAt,
    deletedAt: manualWine.deletedAt,
    latestAssessment: latestAssessment
        ? presentAssessment(latestAssessment)
        : null,
    freshness: deriveAssessmentFreshness({
        assessment: latestAssessment,
        currentPalateProfileVersion,
        currentSourceHash: manualWine.sourceHash,
    }),
});

const presentAssessment = item => {
    const assessment = item.assessment ?? {};

    return {
        assessmentInputKey: item.assessmentInputKey,
        sourceKey: item.sourceKey,
        assessmentVersion: item.assessmentVersion ?? 1,
        palateProfileVersion: item.palateProfileVersion,
        fit: assessment.fit ?? item.fit,
        confidence: assessment.confidence ?? item.confidence,
        highlight: assessment.highlight ?? item.highlight,
        headline: assessment.headline ?? item.headline ?? null,
        summary: assessment.summary ?? item.summary ?? null,
        reasoningMode: assessment.reasoningMode,
        reasons: assessment.reasons,
        cautions: assessment.cautions,
        evidence: assessment.evidence,
        assumptions: assessment.assumptions,
        palateAlignment: assessment.palateAlignment,
        styleProfile: assessment.styleProfile,
        completedAt: item.completedAt,
    };
};

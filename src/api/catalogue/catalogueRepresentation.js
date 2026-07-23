import { deriveAssessmentFreshness } from '@grapescrape/domain/assessment/deriveAssessmentFreshness';

export const toCatalogueWine = ({
    wine,
    latestAssessment,
    currentPalateProfileVersion,
    retailerLabel,
}) => ({
    sourceKey: wine.sourceKey,
    retailerId: wine.retailerId,
    retailerLabel,
    retailerWineId: String(wine.id),
    name: wine.name,
    vintage: wine.vintage,
    region: wine.region ?? null,
    grape: wine.grape ?? null,
    alcohol: wine.alcohol ?? null,
    description: wine.description ?? null,
    currentPrice: {
        amount: formatPrice(wine.price),
        currency: 'GBP',
    },
    firstSeenAt: wine.firstSeenAt,
    lastSeenAt: wine.lastSeenAt,
    latestAssessment: latestAssessment
        ? toPublicAssessment(latestAssessment, wine.sourceKey)
        : null,
    freshness: deriveAssessmentFreshness({
        assessment: latestAssessment,
        currentPalateProfileVersion,
        currentSourceHash: wine.sourceHash,
    }),
});

const toPublicAssessment = (storedAssessment, sourceKey) => {
    const assessment = storedAssessment.assessment ?? {};

    return {
        assessmentInputKey: storedAssessment.assessmentInputKey,
        sourceKey,
        assessmentVersion: storedAssessment.assessmentVersion ?? 1,
        palateProfileVersion: storedAssessment.palateProfileVersion,
        fit: assessment.fit ?? storedAssessment.fit,
        confidence: assessment.confidence ?? storedAssessment.confidence,
        highlight: assessment.highlight ?? storedAssessment.highlight,
        headline: assessment.headline ?? storedAssessment.headline ?? null,
        summary: assessment.summary ?? storedAssessment.summary ?? null,
        reasoningMode: assessment.reasoningMode,
        reasons: assessment.reasons,
        cautions: assessment.cautions,
        evidence: assessment.evidence,
        assumptions: assessment.assumptions,
        palateAlignment: assessment.palateAlignment,
        styleProfile: assessment.styleProfile,
        completedAt: storedAssessment.completedAt,
    };
};

const formatPrice = price => {
    if (price === null || price === undefined || price === '') {
        throw new Error('Catalogue wine has an invalid current price');
    }

    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice)) {
        throw new Error('Catalogue wine has an invalid current price');
    }

    return numericPrice.toFixed(2);
};

import crypto from 'node:crypto';

export const ASSESSMENT_VERSION = 1;

export const createAssessmentSourceHash = wine => {
    const source = {
        name: wine.name ?? null,
        vintage: wine.vintage ?? null,
        region: wine.region ?? null,
        grape: wine.grape ?? null,
        alcohol: wine.alcohol ?? null,
        description: wine.description ?? wine.desc ?? null
    };

    return crypto
        .createHash('sha256')
        .update(JSON.stringify(source))
        .digest('hex');
};

export const isCachedAssessmentValid = ({ cached, sourceHash, palateProfileVersion, assessmentVersion = ASSESSMENT_VERSION }) => {
    if (!cached) return false;

    return cached.sourceHash === sourceHash &&
        cached.palateProfileVersion === palateProfileVersion &&
        cached.assessmentVersion === assessmentVersion;
};

export const shouldHighlightAssessment = assessment =>
    assessment?.highlight === true &&
    ['strong', 'good'].includes(assessment.fit) &&
    ['high', 'medium_high'].includes(assessment.confidence);

import {
    deriveAssessmentFreshness,
} from '@grapescrape/domain/assessment/deriveAssessmentFreshness';
import {
    AssessmentHistoryApiError,
    notFound,
} from './assessmentHistoryApiError.js';
import {
    compareAssessmentVersions,
    getAssessmentInputKey,
    getAssessmentVersion,
    paginateAssessmentRows,
    paginateAssessedWineSummaries,
    parseAssessmentListQuery,
    parseAssessedWineQuery,
} from './assessmentHistoryQuery.js';

const RETAILER_LABELS = {
    tws: 'The Wine Society',
};

export const createAssessmentHistoryService = ({
    historyStore,
    getManualWineBySourceKey,
} = {}) => {
    if (!historyStore) throw new Error('Assessment history store is required');
    if (typeof getManualWineBySourceKey !== 'function') {
        throw new Error('getManualWineBySourceKey is required');
    }

    const buildAssessedWine = async ({
        userId,
        assessments,
        currentPalateProfileVersion,
    }) => {
        const completedAssessments = assessments.filter(isCompletedAssessment);

        if (completedAssessments.length === 0) {
            throw notFound(
                'ASSESSED_WINE_NOT_FOUND',
                'No completed assessment was found for this wine.'
            );
        }

        const orderedAssessments = completedAssessments.toSorted(compareAssessmentVersions);
        const latestAssessment = orderedAssessments[0];
        const sourceKey = getSourceKey(latestAssessment);
        const sourceType = getSourceType(latestAssessment);
        let sourceRecord;
        let availability;

        if (sourceType === 'retailer') {
            sourceRecord = await historyStore.getRetailerWineBySourceKey({ sourceKey });
            availability = sourceRecord?.isCurrent === true
                ? 'current_retailer'
                : 'removed_retailer';
        } else {
            sourceRecord = await getManualWineBySourceKey({ userId, sourceKey });

            if (!sourceRecord) {
                const error = new Error('Manual wine history record is unavailable');
                error.name = 'ManualWineHistoryRecordUnavailableError';
                throw error;
            }

            availability = getManualAvailability(sourceRecord);
        }

        const wineSnapshot = latestAssessment.wineSnapshot ?? {};
        const wineSource = sourceRecord ?? wineSnapshot;
        const currentSourceHash = sourceRecord?.sourceHash ?? latestAssessment.sourceHash;
        const retailerId = sourceType === 'retailer'
            ? getRetailerId(sourceRecord, sourceKey)
            : null;

        return {
            sourceKey,
            sourceType,
            retailerId,
            retailerLabel: retailerId ? RETAILER_LABELS[retailerId] ?? null : null,
            wine: {
                name: valueOrNull(wineSource.name ?? wineSnapshot.name),
                vintage: valueOrNull(wineSource.vintage ?? wineSnapshot.vintage),
                region: valueOrNull(wineSource.region ?? wineSnapshot.region),
                grape: valueOrNull(wineSource.grape ?? wineSnapshot.grape),
                alcohol: valueOrNull(wineSource.alcohol ?? wineSnapshot.alcohol),
                description: valueOrNull(wineSource.description ?? wineSnapshot.description),
                availability,
                currentPrice: availability === 'current_retailer'
                    ? createCurrentPrice(sourceRecord?.price)
                    : null,
            },
            latestAssessment: toPublicAssessment(latestAssessment),
            freshness: deriveAssessmentFreshness({
                assessment: latestAssessment,
                currentPalateProfileVersion,
                currentSourceHash,
            }),
            assessmentCount: completedAssessments.length,
            lastAssessedAt: getLatestCompletionTimestamp(completedAssessments),
        };
    };

    return {
        async listAssessedWines({ userId, query = {} } = {}) {
            requireUserId(userId);
            const parsedQuery = parseAssessedWineQuery(query);
            const assessments = await historyStore.listCompletedAssessmentsByUser({ userId });
            const assessmentsBySource = groupAssessmentsBySource(assessments);
            const currentPalateProfileVersion =
                await historyStore.getCurrentPalateProfileVersion({ userId });
            const matchingSourceGroups = [...assessmentsBySource.values()]
                .filter(sourceAssessments =>
                    !parsedQuery.sourceType
                    || getSourceType(sourceAssessments[0]) === parsedQuery.sourceType
                );
            const summaries = await Promise.all(
                matchingSourceGroups.map(sourceAssessments =>
                    buildAssessedWine({
                        userId,
                        assessments: sourceAssessments,
                        currentPalateProfileVersion,
                    })
                )
            );

            return paginateAssessedWineSummaries({
                summaries,
                query: parsedQuery,
            });
        },

        async getAssessedWine({ userId, sourceKey } = {}) {
            requireUserId(userId);
            validateSourceKey(sourceKey);
            const assessments = await historyStore.listCompletedAssessmentsBySource({
                userId,
                sourceKey,
            });
            const currentPalateProfileVersion =
                await historyStore.getCurrentPalateProfileVersion({ userId });

            return buildAssessedWine({
                userId,
                assessments,
                currentPalateProfileVersion,
            });
        },

        async listAssessments({ userId, sourceKey, query = {} } = {}) {
            requireUserId(userId);
            validateSourceKey(sourceKey);
            const parsedQuery = parseAssessmentListQuery(query);
            const assessments = (
                await historyStore.listCompletedAssessmentsBySource({ userId, sourceKey })
            ).filter(isCompletedAssessment);

            if (assessments.length === 0) {
                throw notFound(
                    'ASSESSED_WINE_NOT_FOUND',
                    'No completed assessment was found for this wine.'
                );
            }

            const page = paginateAssessmentRows({
                assessments,
                sourceKey,
                query: parsedQuery,
            });

            return {
                items: page.items.map(toPublicAssessment),
                nextCursor: page.nextCursor,
            };
        },

        async getAssessmentVersion({ userId, sourceKey, assessmentVersion } = {}) {
            requireUserId(userId);
            validateSourceKey(sourceKey);
            validateAssessmentVersion(assessmentVersion);
            const assessments = (
                await historyStore.listCompletedAssessmentsBySource({ userId, sourceKey })
            )
                .filter(isCompletedAssessment)
                .filter(assessment =>
                    getAssessmentVersion(assessment) === assessmentVersion
                )
                .toSorted(compareAssessmentVersions);

            if (assessments.length === 0) {
                throw notFound(
                    'ASSESSMENT_NOT_FOUND',
                    'The completed assessment was not found.'
                );
            }

            return toPublicAssessment(assessments[0]);
        },
    };
};

const groupAssessmentsBySource = assessments => {
    const grouped = new Map();

    for (const assessment of assessments.filter(isCompletedAssessment)) {
        const sourceKey = getSourceKey(assessment);

        if (!sourceKey) continue;

        const sourceAssessments = grouped.get(sourceKey) ?? [];
        sourceAssessments.push(assessment);
        grouped.set(sourceKey, sourceAssessments);
    }

    return grouped;
};

const toPublicAssessment = item => {
    const assessment = item.assessment ?? {};

    return {
        assessmentInputKey: getAssessmentInputKey(item),
        sourceKey: getSourceKey(item),
        assessmentVersion: getAssessmentVersion(item),
        palateProfileVersion: item.palateProfileVersion,
        fit: assessment.fit ?? item.fit,
        confidence: assessment.confidence ?? item.confidence,
        highlight: assessment.highlight ?? item.highlight,
        headline: assessment.headline ?? item.headline ?? null,
        summary: assessment.summary ?? item.summary ?? null,
        reasoningMode: assessment.reasoningMode,
        reasons: assessment.reasons ?? [],
        cautions: assessment.cautions ?? [],
        evidence: assessment.evidence ?? [],
        assumptions: assessment.assumptions ?? [],
        palateAlignment: assessment.palateAlignment,
        styleProfile: assessment.styleProfile,
        completedAt: item.completedAt ?? item.createdAt,
    };
};

const createCurrentPrice = price => {
    if (
        price === null
        || price === undefined
        || (typeof price === 'string' && price.trim().length === 0)
    ) {
        return null;
    }

    const amount = Number(price);

    if (!Number.isFinite(amount)) return null;

    return {
        amount: amount.toFixed(2),
        currency: 'GBP',
    };
};

const getManualAvailability = wine => {
    if (wine.isActive === true || wine.status === 'active') {
        return 'active_manual';
    }

    if (wine.isActive === false || wine.status === 'deleted') {
        return 'deleted_manual';
    }

    const error = new Error('Manual wine status is unavailable');
    error.name = 'ManualWineStatusUnavailableError';
    throw error;
};

const isCompletedAssessment = assessment =>
    assessment?.status === 'completed';

const getSourceKey = assessment =>
    assessment?.sourceKey ?? assessment?.source?.key;

const getSourceType = assessment => {
    const sourceKey = getSourceKey(assessment);
    const sourceType = assessment?.source?.type ?? sourceKey?.split(':')[0];

    if (sourceType !== 'retailer' && sourceType !== 'manual') {
        const error = new Error('Assessment source type is invalid');
        error.name = 'InvalidAssessmentSourceTypeError';
        throw error;
    }

    return sourceType;
};

const getRetailerId = (sourceRecord, sourceKey) =>
    sourceRecord?.retailerId ?? sourceKey.split(':')[1];

const getLatestCompletionTimestamp = assessments =>
    assessments
        .map(assessment => assessment.completedAt ?? assessment.createdAt)
        .toSorted()
        .at(-1);

const validateSourceKey = sourceKey => {
    const isRetailer = /^retailer:[^:]+:.+$/.test(sourceKey);
    const isManual =
        /^manual:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(sourceKey);

    if (!isRetailer && !isManual) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The source key is invalid.',
        });
    }
};

const validateAssessmentVersion = assessmentVersion => {
    if (!Number.isSafeInteger(assessmentVersion) || assessmentVersion < 1) {
        throw new AssessmentHistoryApiError({
            statusCode: 400,
            code: 'INVALID_REQUEST',
            message: 'The assessment version is invalid.',
        });
    }
};

const requireUserId = userId => {
    if (!userId) throw new Error('userId is required');
};

const valueOrNull = value => value ?? null;

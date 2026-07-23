import { createAssessmentInputKey } from '@grapescrape/domain/assessment/createAssessmentInputKey';
import {
    buildCompletedAssessmentItem,
    isCompletedAssessmentConflict,
} from '@grapescrape/state/dynamodb/assessmentStore';
import {
    parseAssessmentMessage,
    validateAssessmentMessage,
} from './validateAssessmentMessage.js';
import { buildPalateProfileAssessmentContext } from './buildPalateProfileAssessmentContext.js';

export const processAssessmentRequest = async ({
    record,
    assessmentStore,
    assessmentProvider,
    userId = process.env.DEFAULT_USER_ID,
    model = process.env.OPENAI_MODEL,
    now = () => new Date().toISOString(),
}) => {
    if (!record) throw new Error('SQS record is required');
    if (!assessmentStore) throw new Error('Assessment store is required');
    if (!assessmentProvider) throw new Error('Assessment provider is required');

    const message = validateAssessmentMessage(parseAssessmentMessage(record.body));
    const resolvedUserId = message.userId ?? userId;

    if (!resolvedUserId) throw new Error('AssessmentRequested message userId or DEFAULT_USER_ID is required');

    const currentPalateProfile = await assessmentStore.getCurrentPalateProfile(resolvedUserId);

    if (!currentPalateProfile) throw new Error(`Current palate profile was not found for userId=${ resolvedUserId }`);

    const palateProfileVersion = currentPalateProfile.palateProfileVersion ?? currentPalateProfile.version;

    if (!palateProfileVersion) throw new Error(`Current palate profile is missing version for userId=${ resolvedUserId }`);

    const assessmentInputKey = createAssessmentInputKey({
        userId: resolvedUserId,
        sourceKey: message.source.key,
        palateProfileVersion,
        assessmentVersion: message.assessmentVersion,
        sourceHash: message.sourceHash,
    });

    const existingAssessment = await assessmentStore.getAssessmentByInputKey({
        userId: resolvedUserId,
        assessmentInputKey,
    });

    if (existingAssessment?.status === 'completed') {
        console.log(`Completed assessment already exists for requestId=${ message.requestId } assessmentInputKey=${ assessmentInputKey }`);

        if (message.forceReassessment) {
            console.log(`forceReassessment requested for requestId=${ message.requestId }, but same-key assessment is already complete.`);
        }

        return {
            status: 'skipped_existing_assessment',
            assessmentInputKey,
        };
    }

    const assessment = await assessmentProvider.assessWine({
        wine: message.wineSnapshot,
        palateProfile: buildPalateProfileAssessmentContext(currentPalateProfile),
    });

    const completedAssessment = buildCompletedAssessmentItem({
        userId: resolvedUserId,
        assessmentInputKey,
        source: message.source,
        wineSnapshot: message.wineSnapshot,
        sourceHash: message.sourceHash,
        palateProfileVersion,
        assessmentVersion: message.assessmentVersion,
        model,
        assessment,
        createdAt: now(),
    });

    try {
        await assessmentStore.putCompletedAssessment(completedAssessment);
    } catch (error) {
        if (isCompletedAssessmentConflict(error)) {
            console.log(`Completed assessment write conflicted for requestId=${ message.requestId } assessmentInputKey=${ assessmentInputKey }; treating as idempotent success.`);
            return {
                status: 'skipped_conflicting_completed_assessment',
                assessmentInputKey,
            };
        }

        throw error;
    }

    console.log(`Completed assessment for requestId=${ message.requestId } assessmentInputKey=${ assessmentInputKey }`);

    return {
        status: 'completed',
        assessmentInputKey,
    };
};

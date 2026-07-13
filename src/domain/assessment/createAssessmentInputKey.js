import { createHash } from 'node:crypto';

export const createAssessmentInputKey = ({
    userId,
    sourceKey,
    palateProfileVersion,
    assessmentVersion,
    sourceHash,
}) => createHash('sha256')
    .update(JSON.stringify({
        userId,
        sourceKey,
        palateProfileVersion,
        assessmentVersion,
        sourceHash,
    }))
    .digest('hex');

export const parseAssessmentMessage = body => {
    try {
        return JSON.parse(body);
    } catch {
        throw new Error('AssessmentRequested message body must be valid JSON');
    }
};

export const validateAssessmentMessage = message => {
    if (message?.eventType !== 'AssessmentRequested') {
        throw new Error('AssessmentRequested message eventType is required');
    }

    if (!message.requestId) throw new Error('AssessmentRequested message requestId is required');
    if (!message.source?.type) throw new Error('AssessmentRequested message source.type is required');
    if (!message.source?.key) throw new Error('AssessmentRequested message source.key is required');
    if (!message.wineSnapshot) throw new Error('AssessmentRequested message wineSnapshot is required');
    if (!message.sourceHash) throw new Error('AssessmentRequested message sourceHash is required');
    if (!message.assessmentVersion) throw new Error('AssessmentRequested message assessmentVersion is required');

    if (message.wineSnapshot.sourceHash && message.wineSnapshot.sourceHash !== message.sourceHash) {
        throw new Error('AssessmentRequested message wineSnapshot.sourceHash must match sourceHash');
    }

    return message;
};

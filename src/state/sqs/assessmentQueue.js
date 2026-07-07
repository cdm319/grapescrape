import { SendMessageCommand } from '@aws-sdk/client-sqs';

export const createAssessmentQueue = client => {
    const queueUrl = process.env.ASSESSMENT_QUEUE_URL;

    if (!client) throw new Error('AWS SQS client is required.');
    if (!queueUrl) throw new Error('Assessment queue URL is required.');

    return {
        async enqueueAssessmentRequest(req) {
            validateAssessmentRequest(req);

            await client.send(new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify({
                    ...req,
                    eventType: 'AssessmentRequested'
                })
            }));
        },

        async enqueueAssessmentRequests(reqs) {
            await Promise.all(reqs.map(req =>
                this.enqueueAssessmentRequest(req))
            );
        },
    };
};

const validateAssessmentRequest = req => {
    if (!req.requestId) throw new Error('Invalid AssessmentQueueRequest: requestId is required');
    if (!req.source?.type) throw new Error('Invalid AssessmentQueueRequest: source.type is required');
    if (!req.source?.key) throw new Error('Invalid AssessmentQueueRequest: source.key is required');
    if (!req.wineSnapshot) throw new Error('Invalid AssessmentQueueRequest: wineSnapshot is required');
    if (!req.sourceHash) throw new Error('Invalid AssessmentQueueRequest: sourceHash is required');
    if (!req.assessmentVersion) throw new Error('Invalid AssessmentQueueRequest: assessmentVersion is required');
    if (req.wineSnapshot.sourceHash && req.wineSnapshot.sourceHash !== req.sourceHash) {
        throw new Error('Invalid AssessmentQueueRequest: wineSnapshot.sourceHash must match sourceHash');
    }
};

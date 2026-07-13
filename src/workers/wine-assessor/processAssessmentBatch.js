import { processAssessmentRequest } from './processAssessmentRequest.js';

export const resolveAssessmentConcurrency = value => {
    const parsed = Number.parseInt(value ?? '10', 10);

    if (!Number.isFinite(parsed) || parsed < 1) {
        return 10;
    }

    return Math.min(parsed, 10);
};

export const processAssessmentBatch = async ({
    event,
    assessmentStore,
    assessmentProvider,
    defaultUserId = process.env.DEFAULT_USER_ID,
    model = process.env.OPENAI_MODEL,
    concurrency = resolveAssessmentConcurrency(process.env.ASSESSMENT_CONCURRENCY),
    processRecord = processAssessmentRequest,
    now,
}) => {
    const records = event?.Records ?? [];
    const failures = [];
    let nextRecordIndex = 0;

    const processNextRecord = async () => {
        while (nextRecordIndex < records.length) {
            const record = records[nextRecordIndex];
            nextRecordIndex += 1;

            try {
                await processRecord({
                    record,
                    assessmentStore,
                    assessmentProvider,
                    defaultUserId,
                    model,
                    now,
                });
            } catch (error) {
                console.error(`Failed to process assessment record ${ record.messageId }: ${ error.message }`);
                failures.push({ itemIdentifier: record.messageId });
            }
        }
    };

    const workerCount = Math.min(concurrency, records.length);
    await Promise.all(Array.from({ length: workerCount }, () => processNextRecord()));

    return { batchItemFailures: failures };
};

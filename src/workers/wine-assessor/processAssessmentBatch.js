import { processAssessmentRequest } from './processAssessmentRequest.js';

export const processAssessmentBatch = async ({
    records = [],
    assessmentStore,
    assessmentProvider,
    userId = process.env.DEFAULT_USER_ID,
    model = process.env.OPENAI_MODEL,
    concurrency = 10,
    processRecord = processAssessmentRequest,
    now,
}) => {
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
                    userId,
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

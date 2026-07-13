import { documentClient } from '@grapescrape/state/dynamodb/client';
import { createAssessmentStore } from '@grapescrape/state/dynamodb/assessmentStore';
import { createOpenAiWineAssessmentProvider } from './openai/openAiWineAssessmentProvider.js';
import { processAssessmentBatch } from './processAssessmentBatch.js';

const assessmentStore = createAssessmentStore({ client: documentClient });
const assessmentProvider = createOpenAiWineAssessmentProvider();

export const handler = async event => {
    const records = event?.Records ?? [];
    console.log(`GrapeScrape wine assessor starting with ${ records.length } records.`);

    if (records.length === 0) {
        console.log('GrapeScrape wine assessor finished with 0 failed records.');
        return { batchItemFailures: [] };
    }

    const result = await processAssessmentBatch({
        records,
        assessmentStore,
        assessmentProvider,
    });

    console.log(`GrapeScrape wine assessor finished with ${ result.batchItemFailures.length } failed records.`);

    return result;
};

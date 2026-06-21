import { run } from './runner.js'
import { createS3Store } from '../store/s3Store.js';
import { createSnsNotifier } from '../notify/snsNotifier.js';
import { createAssessmentEnricher } from '../assess/assessmentEnricher.js';
import { createOpenAiWineAssessmentProvider } from '../assess/openAiWineAssessmentProvider.js';
import { palateProfile } from '../assess/palateProfile.js';

export const handler = async () => {
    try {
        console.log('Starting GrapeScrape...');

        const assessmentStore = createS3Store({
            bucket: process.env.STORE_BUCKET,
            key: process.env.ASSESSMENT_CACHE_KEY,
            defaultValue: {}
        });

        const assessmentProvider = createOpenAiWineAssessmentProvider();

        const assessmentEnricher = createAssessmentEnricher({
            store: assessmentStore,
            provider: assessmentProvider,
            palateProfile,
            model: process.env.OPENAI_MODEL,
            maxAssessmentsPerRun: Number(process.env.MAX_ASSESSMENTS_PER_RUN ?? 20),
            assessmentConcurrency: Number(process.env.ASSESSMENT_CONCURRENCY ?? 10)
        });

        const result = await run({
            store: createS3Store(),
            notifier: createSnsNotifier(),
            assessmentEnricher
        });

        console.log('GrapeScrape completed.');

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error) {
        console.error('Error running GrapeScrape:', {
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
};

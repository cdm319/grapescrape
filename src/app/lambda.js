import { run } from './runner.js'
import { createS3Store } from "../store/s3Store.js";
import { createSnsNotifier } from "../notify/snsNotifier.js";

export const handler = async () => {
    try {
        const result = await run({
            store: createS3Store(),
            notifier: createSnsNotifier()
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
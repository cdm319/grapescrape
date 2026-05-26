import { run } from './runner.js'
import { createS3Store } from "../store/s3Store.js";
import { createSnsNotifier } from "../notify/snsNotifier.js";

export const handler = async () => {
    const result = await run({
        store: createS3Store(),
        notifier: createSnsNotifier(),
        mode: 'lambda'
    });

    console.log('GrapeScrape completed.');

    return {
        statusCode: 200,
        body: JSON.stringify(result)
    };
};
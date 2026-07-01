import { scrapeRetailers } from "./scrapeRetailers.js";
import { documentClient } from "../../state/dynamodb/client.js";
import { sqsClient } from "../../state/sqs/client.js";
import { createWineStockStore } from "../../state/dynamodb/wineStockStore.js";
import { createSnsNotifier } from "../../state/sns/snsNotifier.js";
import { createAssessmentQueue } from "../../state/sqs/assessmentQueue.js";

// instantiate AWS integrations outside handler for reuse
const wineStockStore = createWineStockStore(documentClient);
const notifier = createSnsNotifier();
const assessmentQueue = createAssessmentQueue(sqsClient);

/**
 * Entry point for the retailer scraper Lambda function.
 *
 * @param event
 * @returns object {statusCode: number, body: string}
 */
export const handler = async (event) => {
    try {
        console.log('GrapeScrape retailer scraper starting.');

        const results = await scrapeRetailers({
            retailerId: 'tws',
            store: wineStockStore,
            notifier,
            queue: assessmentQueue
        });

        console.log('GrapeScrape retailer scraper finished.');

        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };
    } catch (error) {
        console.error('Error in retailer scraper:', error);
        throw error;
    }
};

import { documentClient } from "@grapescrape/state/dynamodb/client";
import { sqsClient } from "@grapescrape/state/sqs/client";
import { createWineStockStore } from "@grapescrape/state/dynamodb/wineStockStore";
import { createSnsNotifier } from "@grapescrape/state/sns/snsNotifier";
import { createAssessmentQueue } from "@grapescrape/state/sqs/assessmentQueue";
import { scrapeRetailers } from "./scrapeRetailers.js";

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

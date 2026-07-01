import { diffWines } from "../../domain/wine/diffWines.js";
import { getCurrentWines } from "../../domain/retailers/index.js";


/**
 * Initiates the scraping of a given retailer's wines, then compares to previous listings, and orchestrates
 * next steps - persisting the data to storage, sending notifications, and enqueuing new assessment requests.
 *
 * @param context - object containing retailerId, store, notifier, and queue
 * @param context.retailerId - the retailer ID to scrape
 * @param context.store - the store to persist the scraped data
 * @param context.notifier - the notifier to send notifications
 * @param context.queue - the queue to enqueue new assessment requests
 * @returns object { total: number, added: number, removed: number }
 */
export const scrapeRetailers = async ({ retailerId, store, notifier, queue }) => {
    if (!store) throw new Error('Store is required');
    if (!notifier) throw new Error('Notifier is required');
    if (!queue) throw new Error('Queue is required');

    // scrape the given retailer
    const current = await getCurrentWines(retailerId);
    if (current.length === 0) throw new Error('No results found');
    console.log(`Scraped ${ current.length } wines from ${ retailerId }`);

    // compare to previous listings
    const previous = await store.listCurrentWinesByRetailer(retailerId);
    const { added, removed } = diffWines(previous, current);
    console.log(`${ added.length } new wines, ${ removed.length } removed wines from previous scrape`);

    // update store with current run
    await store.upsertWineListings({ retailerId, current });
    console.log(`Updated store with current listings`);

    // mark removed wines as missing
    if (removed.length) {
        await store.markListingsMissing({
            retailerId,
            wines: removed
        });
        console.log(`Updated store to mark ${ removed.length } wines as missing`);
    }

    // send the SNS notification
    if (added.length || removed.length) {
        await notifier.notify({ added, removed, current });
        console.log('Sent notification');
    }

    // add new wines to the queue for assessment
    if (added.length) {
        await queue.enqueueAssessmentRequests(
            added.map(wine => ({
                requestId: crypto.randomUUID(),
                source: { type: 'retailer', key: `retailer:${ retailerId }:${ wine.id }` },
                wine: wine,
                sourceHash: wine.sourceHash,
                assessmentVersion: 1,
                requestedAt: new Date().toISOString()
            }))
        );
        console.log(`Enqueued ${ added.length } new assessment requests`);
    }

    return {
        total: current.length,
        added: added.length,
        removed: removed.length
    };
};
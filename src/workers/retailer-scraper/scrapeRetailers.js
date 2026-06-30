import { diffWines } from "../../utils.js";

export const scrapeRetailers = async ({ retailerId, store, notifier, queue }) => {
    if (!store) throw new Error('Store is required');
    if (!notifier) throw new Error('Notifier is required');
    if (!queue) throw new Error('Queue is required');

    const current = await getCurrentWines();
    if (current.length === 0) throw new Error('No results found');

    const previous = await store.listCurrentWinesByRetailer(retailerId);
    const { added, removed } = diffWines(previous, current);

    // update store with current run
    await store.upsertWineListings({ retailerId, current });

    // mark removed wines as missing
    if (removed.length) {
        await store.markListingsMissing({
            retailerId,
            wines: removed
        });
    }

    // send the SNS notification
    if (added.length || removed.length) {
        await notifier.notify({ added, removed, current });
    }

    // add new wines to the queue for assessment
    if (added.length) {
        await queue.enqueueAssessmentRequests(
            added.map(wine => ({
                requestId: crypto.randomUUID(),
                source: { type: 'retailer', key: retailerId },
                wine: wine,
                sourceHash: wine.sourceHash,
                assessmentVersion: 1,
                requestedAt: new Date().toISOString()
            }))
        );
    }

    return {
        total: current.length,
        added: added.length,
        removed: removed.length
    };
};
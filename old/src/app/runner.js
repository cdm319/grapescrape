import { getCurrentWines } from "../service/wineService.js";
import { diffWines } from "../utils.js";

export const run = async ({ store, notifier, getWines = getCurrentWines, assessmentEnricher }) => {
    const current = await getWines();

    if (current.length === 0) throw new Error('No results found');

    current.sort((a, b) => a.price - b.price);

    if (!store) throw new Error('Store is not defined');
    if (!notifier) throw new Error('Notifier is not defined');

    const previous = await store.load();
    const { added, removed } = diffWines(previous, current);

    let highlightedMatches = [];

    if (assessmentEnricher && current.length) {
        try {
            highlightedMatches = await assessmentEnricher.assessWines(current);
        } catch (error) {
            console.error('Error assessing wines:', error);
        }
    }

    await store.save(current);

    if (added.length || removed.length || highlightedMatches.length) {
        await notifier.notify({ added, removed, current, highlightedMatches });
    }

    return {
        total: current.length,
        added: added.length,
        removed: removed.length,
        highlightedMatches: highlightedMatches.length
    };
};

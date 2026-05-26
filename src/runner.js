import { getCurrentWines } from "./wineService.js";

export const run = async ({ mode = 'local' } = {}) => {
    const results = await getCurrentWines();

    if (results.length === 0) {
        console.log('No results found.');
        return;
    }

    results.sort((a, b) => a.price - b.price);

    if (mode === 'local') {
        console.table(results);
        console.log(`Number of results: ${results.length}`);
    }
};

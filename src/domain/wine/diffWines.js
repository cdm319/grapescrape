/**
 * Compares two arrays of wines and returns the added and removed wines.
 *
 * @param previous - the previous array of wines
 * @param current - the current array of wines
 * @returns object - an object containing the added and removed wines
 */
export const diffWines = (previous, current) => {
    const previousById = new Map(previous.map(wine => [wine.id, wine]));
    const currentById = new Map(current.map(wine => [wine.id, wine]));

    return {
        added: current.filter(wine => !previousById.has(wine.id)),
        removed: previous.filter(wine => !currentById.has(wine.id)),
    };
};
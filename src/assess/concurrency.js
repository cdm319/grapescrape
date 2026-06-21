export const mapWithConcurrency = async (items, concurrency, mapper) => {
    if (!Array.isArray(items)) throw new Error('Items must be an array');
    if (typeof mapper !== 'function') throw new Error('Mapper must be a function');

    const safeConcurrency = Math.max(1, Number(concurrency) || 1);
    const results = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from(
        { length: Math.min(safeConcurrency, items.length) },
        async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                results[currentIndex] = await mapper(items[currentIndex], currentIndex);
            }
        }
    );

    await Promise.all(workers);

    return results;
};

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const scrape = async (url) => {
    if (!url) {
        throw new Error('Invalid input');
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];

    $('.product-tile__description').each((_, element) => {
        const wine = $(element);

        const name = wine.find('h2.product-tile__name')
            .text()
            .trim();

        const price = wine.find('span.product-pricing__price')
            .first()
            .text()
            .replace(/^\s*Price:\s*/i, '')
            .trim();

        if (name && price) {
            results.push({ name, price });
        }
    });

    return results;
};

const main = async () => {
    try {
        const urls = [
            'https://www.thewinesociety.com/buy/wines/red-wine/france/bordeaux/?sort=7&page=1&vintagefrom=2005&vintageto=2005&unit=14156,14157,147166&status=0,2',
            'https://www.thewinesociety.com/buy/wines/red-wine/france/bordeaux/?sort=7&page=1&vintagefrom=2009&vintageto=2010&unit=14156,14157,147166&status=0,2',
            'https://www.thewinesociety.com/buy/wines/red-wine/france/bordeaux/?sort=7&page=1&vintagefrom=2015&vintageto=2016&unit=14156,14157,147166&status=0,2',
            'https://www.thewinesociety.com/buy/wines/red-wine/france/bordeaux/?sort=7&page=1&vintagefrom=2018&vintageto=2020&unit=14156,14157,147166&status=0,2',
            'https://www.thewinesociety.com/buy/wines/red-wine/france/bordeaux/?sort=7&page=1&vintagefrom=2022&vintageto=2022&unit=14156,14157,147166&status=0,2',
        ];

        const results = (await Promise.all(urls.map(scrape))).flat();

        if (results.length === 0) {
            console.log('No results found.');
            return;
        }

        results.forEach(result => {
            console.log(`${result.name} - ${result.price}`);
        });
        console.log(`Number of results: ${results.length}`);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

await main();

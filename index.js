import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

const stripFirstLine = text => text.slice(text.indexOf('\n') + 1);
const normaliseCurrency = text => {
    if (!text) return null;

    return parseFloat(text.split(' ')[0].replace(/[^\d.]/g, '')).toFixed(2);
}

const scrape = async (url) => {
    if (!url) {
        throw new Error('Invalid input');
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }

    const csv = await response.text();
    const cleanedCsv = stripFirstLine(csv);

    const records = parse(cleanedCsv, {
        columns: header => header.map(column => column.trim().toLowerCase().replace(/\s+/g, '_')),
        skip_empty_lines: true,
        trim: true
    });

    return records.map(w => ({
        ...w,
        price: normaliseCurrency(w.price)
    }));
};

const main = async () => {
    try {
        const urls = [
            'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv?contentId=1073742856&parameters=%7B%22Body%22%3A%22%22,%22Closure%22%3A%22%22,%22Country%22%3A%22%22,%22DrinkEndFrom%22%3A%22%22,%22DrinkEndTo%22%3A%22%22,%22DrinkStartFrom%22%3A%22%22,%22DrinkStartTo%22%3A%22%22,%22Food%22%3A%22%22,%22Grape%22%3A%22%22,%22HideCountry%22%3Afalse,%22HideRegion%22%3Afalse,%22HideSubRegion%22%3Afalse,%22LevelMaximum%22%3Anull,%22LevelMinimum%22%3Anull,%22Oak%22%3A%22%22,%22Organic%22%3A%22%22,%22Producer%22%3A%22%22,%22ProductType%22%3A%22%22,%22Region%22%3A%22%22,%22Style%22%3A%22%22,%22SubRegion%22%3A%22%22,%22Unit%22%3A%2214156,14157,147166%22,%22VintageFrom%22%3A%222005%22,%22VintageTo%22%3A%222005%22,%22ReserveAction%22%3A1,%22DrinkStatus%22%3Anull,%22OnOfferStatus%22%3Anull,%22PartsListQuantity%22%3Anull,%22PriceMaximum%22%3Anull,%22PriceMinimum%22%3Anull,%22PriceRange%22%3A%22%22,%22Rating%22%3A%22%22,%22Saving%22%3A%22%22,%22Sort%22%3A7,%22StarRatingFrom%22%3Anull,%22StarRatingTo%22%3Anull,%22Status%22%3A%220,2%22,%22Type%22%3A1,%22View%22%3A1,%22TempCategoryContent%22%3A%221073742303__CatalogContent%22,%22Page%22%3A1,%22PageSize%22%3A90,%22q%22%3A%22%22,%22SearchTerm%22%3A%22%22%7D',
            'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv?contentId=1073742856&parameters=%7B%22Body%22%3A%22%22,%22Closure%22%3A%22%22,%22Country%22%3A%22%22,%22DrinkEndFrom%22%3A%22%22,%22DrinkEndTo%22%3A%22%22,%22DrinkStartFrom%22%3A%22%22,%22DrinkStartTo%22%3A%22%22,%22Food%22%3A%22%22,%22Grape%22%3A%22%22,%22HideCountry%22%3Afalse,%22HideRegion%22%3Afalse,%22HideSubRegion%22%3Afalse,%22LevelMaximum%22%3Anull,%22LevelMinimum%22%3Anull,%22Oak%22%3A%22%22,%22Organic%22%3A%22%22,%22Producer%22%3A%22%22,%22ProductType%22%3A%22%22,%22Region%22%3A%22%22,%22Style%22%3A%22%22,%22SubRegion%22%3A%22%22,%22Unit%22%3A%2214156,14157,147166%22,%22VintageFrom%22%3A%222009%22,%22VintageTo%22%3A%222010%22,%22ReserveAction%22%3A1,%22DrinkStatus%22%3Anull,%22OnOfferStatus%22%3Anull,%22PartsListQuantity%22%3Anull,%22PriceMaximum%22%3Anull,%22PriceMinimum%22%3Anull,%22PriceRange%22%3A%22%22,%22Rating%22%3A%22%22,%22Saving%22%3A%22%22,%22Sort%22%3A7,%22StarRatingFrom%22%3Anull,%22StarRatingTo%22%3Anull,%22Status%22%3A%220,2%22,%22Type%22%3A1,%22View%22%3A1,%22TempCategoryContent%22%3A%221073742303__CatalogContent%22,%22Page%22%3A1,%22PageSize%22%3A90,%22q%22%3A%22%22,%22SearchTerm%22%3A%22%22%7D',
            'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv?contentId=1073742856&parameters=%7B%22Body%22%3A%22%22,%22Closure%22%3A%22%22,%22Country%22%3A%22%22,%22DrinkEndFrom%22%3A%22%22,%22DrinkEndTo%22%3A%22%22,%22DrinkStartFrom%22%3A%22%22,%22DrinkStartTo%22%3A%22%22,%22Food%22%3A%22%22,%22Grape%22%3A%22%22,%22HideCountry%22%3Afalse,%22HideRegion%22%3Afalse,%22HideSubRegion%22%3Afalse,%22LevelMaximum%22%3Anull,%22LevelMinimum%22%3Anull,%22Oak%22%3A%22%22,%22Organic%22%3A%22%22,%22Producer%22%3A%22%22,%22ProductType%22%3A%22%22,%22Region%22%3A%22%22,%22Style%22%3A%22%22,%22SubRegion%22%3A%22%22,%22Unit%22%3A%2214156,14157,147166%22,%22VintageFrom%22%3A%222015%22,%22VintageTo%22%3A%222016%22,%22ReserveAction%22%3A1,%22DrinkStatus%22%3Anull,%22OnOfferStatus%22%3Anull,%22PartsListQuantity%22%3Anull,%22PriceMaximum%22%3Anull,%22PriceMinimum%22%3Anull,%22PriceRange%22%3A%22%22,%22Rating%22%3A%22%22,%22Saving%22%3A%22%22,%22Sort%22%3A7,%22StarRatingFrom%22%3Anull,%22StarRatingTo%22%3Anull,%22Status%22%3A%220,2%22,%22Type%22%3A1,%22View%22%3A1,%22TempCategoryContent%22%3A%221073742303__CatalogContent%22,%22Page%22%3A1,%22PageSize%22%3A90,%22q%22%3A%22%22,%22SearchTerm%22%3A%22%22%7D',
            'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv?contentId=1073742856&parameters=%7B%22Body%22%3A%22%22,%22Closure%22%3A%22%22,%22Country%22%3A%22%22,%22DrinkEndFrom%22%3A%22%22,%22DrinkEndTo%22%3A%22%22,%22DrinkStartFrom%22%3A%22%22,%22DrinkStartTo%22%3A%22%22,%22Food%22%3A%22%22,%22Grape%22%3A%22%22,%22HideCountry%22%3Afalse,%22HideRegion%22%3Afalse,%22HideSubRegion%22%3Afalse,%22LevelMaximum%22%3Anull,%22LevelMinimum%22%3Anull,%22Oak%22%3A%22%22,%22Organic%22%3A%22%22,%22Producer%22%3A%22%22,%22ProductType%22%3A%22%22,%22Region%22%3A%22%22,%22Style%22%3A%22%22,%22SubRegion%22%3A%22%22,%22Unit%22%3A%2214156,14157,147166%22,%22VintageFrom%22%3A%222018%22,%22VintageTo%22%3A%222020%22,%22ReserveAction%22%3A1,%22DrinkStatus%22%3Anull,%22OnOfferStatus%22%3Anull,%22PartsListQuantity%22%3Anull,%22PriceMaximum%22%3Anull,%22PriceMinimum%22%3Anull,%22PriceRange%22%3A%22%22,%22Rating%22%3A%22%22,%22Saving%22%3A%22%22,%22Sort%22%3A7,%22StarRatingFrom%22%3Anull,%22StarRatingTo%22%3Anull,%22Status%22%3A%220,2%22,%22Type%22%3A1,%22View%22%3A1,%22TempCategoryContent%22%3A%221073742303__CatalogContent%22,%22Page%22%3A1,%22PageSize%22%3A90,%22q%22%3A%22%22,%22SearchTerm%22%3A%22%22%7D',
            'https://www.thewinesociety.com/CustomFileDownload/DownloadCsv?contentId=1073742856&parameters=%7B%22Body%22%3A%22%22,%22Closure%22%3A%22%22,%22Country%22%3A%22%22,%22DrinkEndFrom%22%3A%22%22,%22DrinkEndTo%22%3A%22%22,%22DrinkStartFrom%22%3A%22%22,%22DrinkStartTo%22%3A%22%22,%22Food%22%3A%22%22,%22Grape%22%3A%22%22,%22HideCountry%22%3Afalse,%22HideRegion%22%3Afalse,%22HideSubRegion%22%3Afalse,%22LevelMaximum%22%3Anull,%22LevelMinimum%22%3Anull,%22Oak%22%3A%22%22,%22Organic%22%3A%22%22,%22Producer%22%3A%22%22,%22ProductType%22%3A%22%22,%22Region%22%3A%22%22,%22Style%22%3A%22%22,%22SubRegion%22%3A%22%22,%22Unit%22%3A%2214156,14157,147166%22,%22VintageFrom%22%3A%222022%22,%22VintageTo%22%3A%222022%22,%22ReserveAction%22%3A1,%22DrinkStatus%22%3Anull,%22OnOfferStatus%22%3Anull,%22PartsListQuantity%22%3Anull,%22PriceMaximum%22%3Anull,%22PriceMinimum%22%3Anull,%22PriceRange%22%3A%22%22,%22Rating%22%3A%22%22,%22Saving%22%3A%22%22,%22Sort%22%3A7,%22StarRatingFrom%22%3Anull,%22StarRatingTo%22%3Anull,%22Status%22%3A%220,2%22,%22Type%22%3A1,%22View%22%3A1,%22TempCategoryContent%22%3A%221073742303__CatalogContent%22,%22Page%22%3A1,%22PageSize%22%3A90,%22q%22%3A%22%22,%22SearchTerm%22%3A%22%22%7D'
        ];

        const results = (await Promise.all(urls.map(scrape))).flat();

        if (results.length === 0) {
            console.log('No results found.');
            return;
        }

        results.sort((a, b) => a.price - b.price);
        results.forEach(result => {
            console.log(`${result.product_code}: ${result.product_title} - £${result.price}`);
        });
        console.log(`Number of results: ${results.length}`);
    } catch (e) {
        console.error('Error:', e.message);
    }
};

await main();
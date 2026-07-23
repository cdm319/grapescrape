import { documentClient } from '@grapescrape/state/dynamodb/client';
import { createCatalogueStore } from '@grapescrape/state/dynamodb/catalogueStore';
import { createCatalogueHandler } from './catalogue.js';

const catalogueStore = createCatalogueStore({
    client: documentClient,
});

export const handler = createCatalogueHandler({
    catalogueStore,
});

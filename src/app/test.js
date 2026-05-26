import { run } from './runner.js';
import { createLocalStore } from "../store/localStore.js";
import { consoleNotifier } from "../notify/consoleNotifier.js";

const stubWines = [
    { id: 'ABC001', region: 'Bordeaux', vintage: '2019', name: 'Chateau Test, Saint-Julien', price: 25 },
    { id: 'ABC002', region: 'Rioja', vintage: '2016', name: 'Test Rioja Reserva', price: 18.5 }
];

try {
    await run({
        store: createLocalStore('testStore.json'),
        notifier: consoleNotifier,
        getWines: async () => stubWines
    });
} catch (error) {
    console.error(error.message);
}
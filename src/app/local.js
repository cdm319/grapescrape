import { run } from './runner.js';
import { createLocalStore } from "../store/localStore.js";
import { consoleNotifier } from "../notify/consoleNotifier.js";

try {
    await run({
        store: createLocalStore(),
        notifier: consoleNotifier,
        mode: 'local'
    });
} catch (error) {
    console.error(error.message);
}
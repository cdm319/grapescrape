import { run } from './runner.js';

try {
    await run({ mode: 'local' });
} catch (error) {
    console.error(error.message);
}
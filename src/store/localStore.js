import { promises as fs } from 'node:fs';

const STORE_PATH = './localStore.json';

export const createLocalStore = ( path = STORE_PATH ) => ({
    async load() {
        try {
            const data = await fs.readFile(path, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') return []; // file does not exist, return empty array

            throw error;
        }
    },

    async save(data) {
        await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
    }
});
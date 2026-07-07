import { promises as fs } from 'node:fs';

export const createLocalStore = (path = './localStore.json') => ({
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
export const consoleNotifier = {
    async notify({ added, removed, current }) {
        if (added.length) {
            console.log('\nNew Wines: ');
            console.table(added);
        }

        if (removed.length) {
            console.log('\nRemoved Wines: ');
            console.table(removed);
        }

        if (current.length) {
            console.log('\nCurrent Wines: ');
            console.table(current);
        }
    }
};
import { describe, expect, it } from 'vitest';
import { buildMessage, formatWine } from '@grapescrape/state/sns/snsNotifier';

describe('snsNotifier message formatting', () => {
    it('formats a wine line for notification text', () => {
        expect(formatWine({ name: 'Wine One', vintage: 2020, price: '25.50' }))
            .toBe('Wine One 2020 - £25.50');
    });

    it('builds an update message with added, removed, and current stock sections', () => {
        const message = buildMessage({
            added: [{ name: 'New Wine', vintage: 2021, price: '30.00' }],
            removed: [{ name: 'Removed Wine', vintage: 2018, price: '18.00' }],
            current: [
                { name: 'New Wine', vintage: 2021, price: '30.00' },
                { name: 'Kept Wine', vintage: 2019, price: '22.00' }
            ]
        });

        expect(message).toBe([
            'GrapeScrape Update',
            '',
            'New Wines (1):',
            '+ New Wine 2021 - £30.00',
            '',
            'Removed Wines (1):',
            '- Removed Wine 2018 - £18.00',
            '',
            'Current Stock (2):',
            'New Wine 2021 - £30.00',
            'Kept Wine 2019 - £22.00'
        ].join('\n'));
    });
});

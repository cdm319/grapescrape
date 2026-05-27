import { describe, expect, it } from 'vitest';
import { buildMessage, formatWine, createSnsNotifier } from '../../src/notify/snsNotifier.js';

describe('formatWine', () => {
    it('should format wine name, vintage and price', () => {
        const wine = {
            name: 'Château Test',
            vintage: 2020,
            price: '25.00',
        };

        expect(formatWine(wine)).toBe('Château Test 2020 - £25.00');
    });
});

describe('buildMessage', () => {
    it('should include added wines, removed wines and current stock', () => {
        const message = buildMessage({
            added: [
                { name: 'New Wine', vintage: 2021, price: '30.00' },
            ],
            removed: [
                { name: 'Removed Wine', vintage: 2019, price: '20.00' },
            ],
            current: [
                { name: 'New Wine', vintage: 2021, price: '30.00' },
                { name: 'Existing Wine', vintage: 2018, price: '18.50' },
            ],
        });

        expect(message).toBe([
            'GrapeScrape Update',
            '',
            'New Wines (1):',
            '+ New Wine 2021 - £30.00',
            '',
            'Removed Wines (1):',
            '- Removed Wine 2019 - £20.00',
            '',
            'Current Stock (2):',
            'New Wine 2021 - £30.00',
            'Existing Wine 2018 - £18.50',
        ].join('\n'));
    });

    it('should omit added and removed sections when there are no changes', () => {
        const message = buildMessage({
            added: [],
            removed: [],
            current: [
                { name: 'Existing Wine', vintage: 2018, price: '18.50' },
            ],
        });

        expect(message).toBe([
            'GrapeScrape Update',
            '',
            'Current Stock (1):',
            'Existing Wine 2018 - £18.50',
        ].join('\n'));
    });

    it('should include only added and current sections when there are no removed wines', () => {
        const message = buildMessage({
            added: [
                { name: 'New Wine', vintage: 2022, price: '22.00' },
            ],
            removed: [],
            current: [
                { name: 'New Wine', vintage: 2022, price: '22.00' },
            ],
        });

        expect(message).toContain('New Wines (1):');
        expect(message).toContain('+ New Wine 2022 - £22.00');
        expect(message).not.toContain('Removed Wines');
        expect(message).toContain('Current Stock (1):');
    });

    it('should include only removed and current sections when there are no added wines', () => {
        const message = buildMessage({
            added: [],
            removed: [
                { name: 'Removed Wine', vintage: 2020, price: '19.00' },
            ],
            current: [
                { name: 'New Wine', vintage: 2022, price: '22.00' },
            ],
        });

        expect(message).toContain('Removed Wines (1):');
        expect(message).toContain('- Removed Wine 2020 - £19.00');
        expect(message).not.toContain('Added Wines');
        expect(message).toContain('Current Stock (1):');
    });
});

describe('createSnsNotifier', () => {
    it('requires a topic ARN', () => {
        expect(() => createSnsNotifier({ topicArn: '' })).toThrow('Topic ARN is required');
    });
});

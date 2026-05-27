import { describe, expect, it } from 'vitest';
import { createSnsNotifier } from '../../src/notify/snsNotifier.js';

describe('createSnsNotifier', () => {
    it('requires a topic ARN', () => {
        expect(() => createSnsNotifier({ topicArn: '' })).toThrow('Topic ARN is required');
    });
});

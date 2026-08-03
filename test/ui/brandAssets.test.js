import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionBrandAssets = [
    'src/ui/public/grapescrape-logo.svg',
    'src/ui/public/grapescrape-mark.svg',
];

describe('production Cognito brand assets', () => {
    it.each(productionBrandAssets)(
        '%s omits SVG accessibility attributes unsupported by managed login',
        (assetPath) => {
            const source = readFileSync(assetPath, 'utf8');

            expect(source).not.toMatch(/\srole=/);
            expect(source).not.toMatch(/\saria-labelledby=/);
        },
    );
});

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildFrontendRequestFunctionCode } from '../../infra/lib/frontend-request-function.js';

function createHandler() {
    const context = {};
    vm.runInNewContext(
        `${buildFrontendRequestFunctionCode({
            appDomainName: 'app.grapescrape.com',
            rootDomainName: 'grapescrape.com',
        })}; this.handler = handler;`,
        context,
    );
    return context.handler;
}

function request(host, uri, querystring = {}) {
    return {
        request: {
            headers: { host: { value: host } },
            querystring,
            uri,
        },
    };
}

describe('frontend CloudFront request function', () => {
    it('redirects the root domain to the application host', () => {
        expect(createHandler()(request('grapescrape.com', '/history/wine', {
            returnTo: { value: '%2Fhistory%2Fwine' },
            tag: {
                multiValue: [{ value: 'red' }, { value: 'sale' }],
                value: 'red',
            },
        }))).toEqual({
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: {
                    value:
                        'https://app.grapescrape.com/history/wine?returnTo=%2Fhistory%2Fwine&tag=red&tag=sale',
                },
                'cache-control': { value: 'public, max-age=300' },
            },
        });
    });

    it.each(['/', '/wines', '/history/wine', '/palate/'])(
        'rewrites the extensionless application route %s to the SPA entry point',
        (uri) => {
            expect(createHandler()(request('app.grapescrape.com', uri)).uri)
                .toBe('/index.html');
        },
    );

    it.each([
        '/assets',
        '/assets/index-123.js',
        '/assets/missing',
        '/grapescrape-logo.svg',
        '/missing.css',
    ])('leaves static asset request %s unchanged', (uri) => {
        expect(createHandler()(request('app.grapescrape.com', uri)).uri).toBe(uri);
    });
});

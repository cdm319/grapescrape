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

function request(host, uri, rawQueryString) {
    return {
        request: {
            headers: { host: { value: host } },
            rawQueryString: () => rawQueryString,
            uri,
        },
    };
}

describe('frontend CloudFront request function', () => {
    it('redirects the root domain to the application host', () => {
        const rawQueryString =
            'tag=red&returnTo=%2fhistory%2Fwine&flag&tag=sale+now&empty=';

        expect(createHandler()(
            request('grapescrape.com', '/history/wine', rawQueryString),
        )).toEqual({
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: {
                    value:
                        `https://app.grapescrape.com/history/wine?${rawQueryString}`,
                },
                'cache-control': { value: 'public, max-age=300' },
            },
        });
    });

    it('does not add a query marker when the request has no query string', () => {
        const response = createHandler()(request('grapescrape.com', '/'));

        expect(response.headers.location.value).toBe('https://app.grapescrape.com/');
    });

    it('preserves an explicitly empty query marker', () => {
        const response = createHandler()(request('grapescrape.com', '/', ''));

        expect(response.headers.location.value).toBe('https://app.grapescrape.com/?');
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

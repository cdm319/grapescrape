function javascriptString(value) {
    return JSON.stringify(value);
}

export function buildFrontendRequestFunctionCode({
    appDomainName,
    rootDomainName,
}) {
    return `function handler(event) {
    var request = event.request;
    var host = request.headers.host && request.headers.host.value.toLowerCase();

    if (host === ${javascriptString(rootDomainName)}) {
        var rawQueryString = request.rawQueryString();
        var query = rawQueryString === undefined ? '' : '?' + rawQueryString;

        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://${appDomainName}' + request.uri + query },
                'cache-control': { value: 'public, max-age=300' }
            }
        };
    }

    var finalSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);
    var isAssetPath = request.uri === '/assets' || request.uri.startsWith('/assets/');
    if (!isAssetPath && !finalSegment.includes('.')) {
        request.uri = '/index.html';
    }

    return request;
}`;
}

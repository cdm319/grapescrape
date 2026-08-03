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
        var queryParts = [];
        var querystring = request.querystring || {};
        Object.keys(querystring).forEach(function (key) {
            var parameter = querystring[key];
            var values = parameter.multiValue || [parameter];
            values.forEach(function (value) {
                queryParts.push(key + '=' + value.value);
            });
        });
        var query = queryParts.length > 0 ? '?' + queryParts.join('&') : '';

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

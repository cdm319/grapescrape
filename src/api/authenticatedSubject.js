const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'content-type': JSON_CONTENT_TYPE,
        },
        body: JSON.stringify(body),
    };
}

export async function handler(event) {
    const requestId = event?.requestContext?.requestId ?? 'unknown';
    const subject = event?.requestContext?.authorizer?.jwt?.claims?.sub;

    if (!subject) {
        return jsonResponse(401, {
            error: {
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required.',
            },
            meta: {
                requestId,
            },
        });
    }

    return jsonResponse(200, {
        data: {
            subject,
        },
        meta: {
            requestId,
        },
    });
}

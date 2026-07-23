# GrapeScrape frontend

The frontend is a React, TypeScript and Vite application. Authentication uses
Cognito managed login with the authorization-code flow and PKCE. Passwords are
never handled by this application.

## Local setup

Run npm commands from the repository root:

```bash
cp src/ui/.env.example src/ui/.env.local
npm install
npm --workspace @grapescrape/ui run dev
```

Replace the example user-pool and client identifiers with the public outputs
from the relevant environment. The Cognito app client must allow
`http://localhost:5173/auth/callback` as a callback URL and
`http://localhost:5173/` as a logout URL before local sign-in will work.

All `VITE_` values are embedded in the browser build and must therefore be
public configuration only. Never put client secrets or access tokens in these
files. Local `.env` files are ignored by Git.

## Configuration

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Authenticated HTTP API origin |
| `VITE_COGNITO_AUTH_DOMAIN` | Cognito managed-login custom domain |
| `VITE_COGNITO_REGION` | Region containing the user pool |
| `VITE_COGNITO_USER_POOL_ID` | Public user-pool identifier |
| `VITE_COGNITO_CLIENT_ID` | Public app-client identifier |
| `VITE_COGNITO_CALLBACK_URL` | Exact browser callback URL |
| `VITE_COGNITO_LOGOUT_URL` | Exact browser return URL after logout |

Callback and logout URLs are validated against the current browser origin.
HTTP is accepted only for loopback local development; hosted configuration
must use HTTPS.

## Validation

```bash
npm --workspace @grapescrape/ui run typecheck
npm --workspace @grapescrape/ui run lint
npm --workspace @grapescrape/ui test
npm --workspace @grapescrape/ui run build
```

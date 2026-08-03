# Frontend production rollout

This runbook provisions and publishes the authenticated React application at
`https://app.grapescrape.com`. The apex `https://grapescrape.com` returns a
permanent redirect to the same path and query string on the application host.

Infrastructure and frontend publication are separate operations. Review every
CDK diff and frontend dry run before executing it. None of the commands in the
implementation of CM-48 were used to deploy or change AWS.

## 1. Prerequisites and safety checks

Use Node.js 24, npm, AWS CLI v2 and credentials for account `668528910170`.
Application resources are in `eu-west-2`; CloudFront and Cognito certificates
are in `us-east-1`. Confirm control of DNS for `grapescrape.com` and the ability
to create ACM-validation CNAMEs and Route 53 alias records (or equivalent
ALIAS/ANAME records at another provider).

```bash
aws sts get-caller-identity
aws configure get region
npm install
npm test
npm run lint
npm run cdk:synth
```

Expected: the account is `668528910170`; tests, lint and synth pass. The local
default region may differ, but all commands below specify a region when it
matters. Do not continue if the CDK diff proposes replacement or deletion of a
retained data table, user pool, queue or other existing persistent resource.

## 2. Review and deploy certificates first

The existing `GrapeScrapeAuthCertificateStack` now contains two non-exportable
public certificates in `us-east-1`:

- `auth.grapescrape.com` for Cognito;
- `grapescrape.com` plus `app.grapescrape.com` for CloudFront.

No Route 53 lookup is performed during synth. This keeps offline synthesis
working and leaves DNS ownership explicit.

```bash
npm --workspace infra run cdk -- diff GrapeScrapeAuthCertificateStack
npm --workspace infra run cdk -- deploy GrapeScrapeAuthCertificateStack --require-approval broadening
```

This deploy can pause while ACM waits for DNS validation. In the ACM console,
or from `describe-certificate`, copy every pending validation record exactly:

```bash
aws acm list-certificates \
  --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='grapescrape.com' || DomainName=='auth.grapescrape.com'].[DomainName,CertificateArn]" \
  --output table

aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn REPLACE_WITH_CERTIFICATE_ARN \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
  --output table
```

For each result create a DNS record with:

- name: the complete `_token.<name>` returned by ACM;
- type: `CNAME`;
- value: the complete `_token.acm-validations.aws.` target;
- TTL: `300` seconds when the DNS provider requests one;
- routing: simple, DNS-only, not proxied.

Keep validation CNAMEs permanently so ACM can renew the certificates. Wait for
both certificates to report `ISSUED` before deploying the application stack.

## 3. Review and deploy application infrastructure

```bash
npm --workspace infra run cdk -- diff GrapeScrapeFutureStack
npm --workspace infra run cdk -- deploy GrapeScrapeFutureStack --require-approval broadening
```

Expected hosting changes:

- one retained, versioned and fully private S3 bucket;
- one CloudFront distribution with Origin Access Control (not a public S3
  website and not legacy OAI);
- one CloudFront viewer-request function;
- one response-headers policy;
- managed-login form-logo and favicon assets;
- cross-region reference to the frontend certificate.

The distribution has two cache behaviours. `/assets/*` uses CloudFront's
caching-optimized policy for Vite's content-hashed bundles. The default
behaviour disables CloudFront caching, so `index.html` and other unhashed files
are always revalidated. The deployment script also assigns browser cache
control explicitly.

Capture the stable outputs:

```bash
aws cloudformation describe-stacks \
  --region eu-west-2 \
  --stack-name GrapeScrapeFutureStack \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

You will need `FrontendBucketName`, `FrontendDistributionId`,
`FrontendDistributionDomainName`, `UserPoolId` and `UserPoolClientId`.

## 4. Create application DNS records

Use the `FrontendDistributionDomainName` output as the target and
`Z2FDTNDATAQYW2` as CloudFront's hosted-zone ID.

For a Route 53 public hosted zone, create all four simple alias records:

| Name | Type | Alias target | Alias hosted-zone ID | Evaluate target health |
| --- | --- | --- | --- | --- |
| `app.grapescrape.com` | `A` | `FrontendDistributionDomainName` | `Z2FDTNDATAQYW2` | No |
| `app.grapescrape.com` | `AAAA` | `FrontendDistributionDomainName` | `Z2FDTNDATAQYW2` | No |
| `grapescrape.com` | `A` | `FrontendDistributionDomainName` | `Z2FDTNDATAQYW2` | No |
| `grapescrape.com` | `AAAA` | `FrontendDistributionDomainName` | `Z2FDTNDATAQYW2` | No |

Route 53 aliases do not use a TTL. At another DNS provider, use `CNAME` for
`app` and the provider's apex-safe `ALIAS`, `ANAME` or CNAME-flattening feature
for the root. Never place a normal CNAME at the zone apex.

Retain the existing records from the authenticated API rollout:

- `api.grapescrape.com`: Route 53 `A` alias to `ApiDnsTarget` using
  `ApiDnsTargetHostedZoneId`, simple routing, target health disabled;
- `auth.grapescrape.com`: `CNAME` to `AuthDnsTarget`, TTL 300, DNS-only.

CloudFront can take several minutes to become globally ready after creation or
configuration changes. DNS pointing at a distribution whose alternate names
are not deployed yet will return a certificate or routing error.

## 5. Configure the public production build

Create the ignored production environment file and replace only the two public
Cognito identifiers:

```bash
cp src/ui/production.env.example src/ui/.env.production.local
```

`VITE_` values are embedded in downloadable JavaScript. They must contain only
the public API origin, Cognito domain/region/user-pool/client identifiers and
callback/logout URLs. Never add a client secret, access token, AWS credential,
OpenAI key or other secret to a `VITE_` variable.

The required production URLs are:

```text
VITE_API_BASE_URL=https://api.grapescrape.com
VITE_COGNITO_AUTH_DOMAIN=https://auth.grapescrape.com
VITE_COGNITO_CALLBACK_URL=https://app.grapescrape.com/auth/callback
VITE_COGNITO_LOGOUT_URL=https://app.grapescrape.com/
```

The Cognito app client already declares those exact callback and logout URLs.
Do not add wildcard redirects.

## 6. Build and publish assets

Export the two hosting outputs:

```bash
export GRAPESCRAPE_FRONTEND_BUCKET="$(aws cloudformation describe-stacks \
  --region eu-west-2 \
  --stack-name GrapeScrapeFutureStack \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue | [0]" \
  --output text)"

export GRAPESCRAPE_FRONTEND_DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --region eu-west-2 \
  --stack-name GrapeScrapeFutureStack \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue | [0]" \
  --output text)"
```

The default command first validates that exactly the seven documented public
VITE values are present across Vite's production environment files and process
environment, builds, scans the build for prohibited prototype or simulator
artifacts and performs only AWS CLI `s3 sync --dryrun` operations. It prints,
but does not create, the CloudFront invalidation:

```bash
npm run frontend:deploy
```

Review every proposed upload and deletion. The build must contain only normal
production output such as `index.html`, the two SVG brand assets and hashed
`assets/` files. It must not contain the prototype ZIP, `.dc.html`,
`support.js`, screenshots or simulator/generated fixtures.

After human approval, execute the same reviewed plan:

```bash
npm run frontend:deploy -- --execute
```

The script uses `--delete`, so it can remove stale objects from the current
bucket view. Bucket versioning makes those removals recoverable. Non-assets,
including `index.html`, receive `no-cache, no-store, must-revalidate`. Hashed
`assets/*` receive `public, max-age=31536000, immutable`. Only `/index.html`
is invalidated; hashed asset names never require invalidation.

## 7. Finish managed-login branding

CDK installs the production `FORM_LOGO` and `FAVICON_SVG` assets from
`src/ui/public`. Their provenance and font licensing are recorded in
`docs/branding/grapescrape-brand-assets.md`.

Cognito's full `Settings` document is owned by the branding editor and is not
strongly typed by the current CDK API. Apply these one-time settings after the
stack deployment rather than committing an unvalidated opaque JSON document:

1. Open Cognito in `eu-west-2`, select `grapescrape-user-pool`.
2. Open **Branding**, **Managed login**, choose the
   `grapescrape-user-pool-client` style, then **Edit**.
3. Keep the deployed GrapeScrape form logo and favicon.
4. Set page background to `#f4f3f0` in light mode and `#1b1d1c` in dark mode.
5. Set form background to `#fbfaf7` in light mode and `#242725` in dark mode.
6. Set the primary branding colour to `#157d6d` in light mode and `#2f9d89`
   in dark mode; use charcoal `#1b1d1c` for light-mode text.
7. Use the managed system sans-serif typography. Do not upload font binaries.
8. Preview sign-in, forgot-password, reset-password and error states at desktop
   and mobile widths, then save.

Later CDK updates supply only image assets, so unspecified editor settings are
preserved by Cognito's managed-login branding API. If branding is rebuilt,
repeat the exact settings above and verify the deployed logo before rollout.

## 8. Smoke-test the rollout

### Hosting, redirect, caching and headers

```bash
curl -I https://grapescrape.com/history?source=bookmark
curl -I https://app.grapescrape.com/
curl -I https://app.grapescrape.com/history
curl -I https://app.grapescrape.com/assets/definitely-missing.js
```

Expected:

- apex returns `301` with
  `Location: https://app.grapescrape.com/history?source=bookmark`;
- `/` and `/history` return the application HTML without a redirect loop;
- a missing `.js` asset returns the S3/CloudFront missing response (`403` or
  `404`), never `index.html`;
- app responses include CSP, HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` and a strict-origin referrer policy;
- `index.html` is no-store/no-cache and a real hashed asset is immutable for
  one year.

The CSP allows only this application, `api.grapescrape.com`,
`auth.grapescrape.com`, Cognito's `eu-west-2` issuer/JWKS origin, and the two
Google Fonts delivery origins. Browser developer tools must show no CSP
violations during login, token exchange or API calls.

### Authentication and API boundary

In a private browser session verify:

1. a protected route redirects to Cognito managed login;
2. there is no public sign-up option;
3. sign-in returns through `/auth/callback` to the intended protected route;
4. logout returns to `https://app.grapescrape.com/` and the route becomes
   protected again;
5. forgot-password and reset-password complete in managed login;
6. an expired session returns to the normal sign-in flow;
7. the browser sends `Authorization: Bearer ...` only to
   `api.grapescrape.com`;
8. an unauthenticated `/v1/auth/session` request returns the API Gateway 401;
9. an authenticated request succeeds and CORS allows only
   `https://app.grapescrape.com`.

### Responsive and accessible application

At desktop and 390px viewport widths verify:

- no horizontal page scrolling;
- mobile navigation is collapsed and **Assess a wine** remains reachable;
- catalogue cards/rows, filter sheet and focus restoration work;
- palate editing, history detail and manual-wine forms remain usable;
- all controls are keyboard reachable, focus is visible and icon-only controls
  have accessible names;
- reduced-motion preference disables non-essential animation;
- text, controls and status colours retain usable contrast.

Complete feature smoke tests for Home partial failures, catalogue filters and
reassessment, full-profile save/conflict handling, assessed-wine history and
manual-wine create/edit/delete/assessment. Never use these smoke tests to call
OpenAI unless a separate production-operation approval explicitly allows it.

## 9. Rollback

For a frontend regression, check out the last known-good Git commit and run the
dry run, review it, then republish with `--execute`. Vite reproduces the old
hashed bundles, the versioned bucket recovers names deleted by a newer sync,
and invalidating `/index.html` makes the restored entry point visible. Do not
invalidate `/*` unless a specific incident proves it necessary.

For infrastructure regressions, revert the CM-48 infrastructure commit,
review `cdk diff`, and deploy only after human approval. The asset bucket is
retained and versioned; do not empty or delete it as a rollback shortcut.
Retain ACM validation records throughout rollback.

## 10. Cost sanity and troubleshooting

The design uses S3 Standard storage/requests, a Price Class 100 CloudFront
distribution, CloudFront Function invocations and normal data transfer. The
non-exportable ACM certificates used by integrated AWS services have no
certificate charge. Each release invalidates one path; AWS currently includes
the first 1,000 invalidation paths per account per month at no charge. Confirm
current prices before rollout at the official
[CloudFront](https://aws.amazon.com/cloudfront/pricing/),
[S3](https://aws.amazon.com/s3/pricing/) and
[ACM](https://aws.amazon.com/certificate-manager/pricing/) pages. After
rollout, check Cost Explorer for unexpected CloudFront transfer/request,
CloudFront Function and S3 request/storage growth.

Common failures:

| Symptom | Check |
| --- | --- |
| Certificate stack waits | Add every ACM validation CNAME exactly and ensure DNS proxying is disabled. |
| CloudFront says the certificate is invalid | The app/apex certificate must be `ISSUED` in `us-east-1` and include both names. |
| App returns S3 XML or 403 | Confirm assets were uploaded to `FrontendBucketName` and the OAC bucket policy exists. |
| Deep link returns 403 | Confirm the viewer-request function is published and associated with the default behaviour. |
| Missing JavaScript returns HTML | Confirm the request has an extension and the edge function leaves `/assets/*` untouched. |
| OAuth callback fails | Compare Cognito callback/logout URLs byte-for-byte with production VITE values. |
| Token/API request is blocked | Inspect CSP and API CORS; only the exact app origin is allowed. |
| Old UI remains | Check `index.html` cache control and the `/index.html` invalidation status; never overwrite a hashed file in place. |
| Branding remains default | Confirm managed-login version 2, the correct app-client style, deployed assets and the one-time editor settings. |

Rollout is successful when both domains have valid TLS, apex redirect and SPA
deep links work, missing assets do not return HTML, cache/security headers are
correct, all auth and core feature smoke tests pass at desktop and 390px, and
the AWS cost check shows only the expected hosting resources.

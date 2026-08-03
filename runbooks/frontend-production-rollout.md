# Frontend production rollout

GrapeScrape is hosted at `https://app.grapescrape.com`. The apex
`https://grapescrape.com` permanently redirects to the same path and raw query
string on the application host.

Production releases run through GitHub Actions. Branch protection on `main` is
the human approval boundary; there is no separate deployment environment gate.
CM-48 changed workflow, infrastructure and documentation only. No workflow was
run, no deployment was performed and no AWS resource or production data was
changed while implementing the ticket.

## Routine release: every approved merge to main

An approved pull request merge to branch-protected `main` is the normal and
authoritative release path:

1. The `CI` workflow runs the full test suite, root workspace lint, frontend
   typecheck, frontend production build and CDK synth before merge.
2. The merge starts the `Deploy` workflow on `main`. A manual
   `workflow_dispatch` is also permitted only when its selected ref is `main`.
3. The workflow repeats release validation before requesting AWS credentials.
4. GitHub OIDC assumes the role in the `AWS_DEPLOY_ROLE_ARN` repository
   variable for account `668528910170` in `eu-west-2`.
5. CDK deploys all stacks. This preserves the established certificate-before-
   application dependency order for the `us-east-1` certificate stack and the
   `eu-west-2` application stack.
6. After CDK succeeds, the workflow reads `FrontendBucketName`,
   `FrontendDistributionId`, `UserPoolId` and `UserPoolClientId` from
   `GrapeScrapeFutureStack`. It stops if any output is absent.
7. Those outputs and the fixed public production URLs feed the safe frontend
   publication script. It rebuilds with production configuration, uploads
   hashed assets first, publishes `index.html` last and invalidates only
   `/index.html`.

The workflow uses one stable production concurrency group with cancellation
disabled, so an active release is never canceled. GitHub keeps at most one
pending run in a concurrency group and can replace an older pending run with a
newer one. The active run completes first; the retained latest pending run then
checks out its own `main` commit, which contains the skipped pending commits and
converges production to the latest approved state. Routine operators must not
run local CDK deploy or asset publication commands in parallel with Actions.

## First deployment only: complete these phases in order

The following checklist is one-time setup for the first CM-48 release. Later
approved merges use the routine path above automatically.

### BEFORE triggering or merging the first CI deployment

- Confirm `main` branch protection requires the intended pull-request review
  and the existing successful `CI / Test` check.
- Confirm the repository variable `AWS_DEPLOY_ROLE_ARN` targets account
  `668528910170`, role `grapescrape-github-actions-deploy`. The role ARN is
  configuration, not a secret.
- Verify the role's GitHub OIDC trust permits this repository's protected
  `main` ref. Do not broaden trust to arbitrary repositories or refs.
- Verify the role retains all permissions needed by the existing CDK deploy
  and also permits:
  - `cloudformation:DescribeStacks` for `GrapeScrapeFutureStack`;
  - `s3:ListBucket` and `s3:GetBucketLocation` on the generated frontend
    bucket;
  - `s3:PutObject` on objects in that bucket;
  - `cloudfront:CreateInvalidation` on the generated distribution.
- Confirm AWS account `668528910170`, application region `eu-west-2` and
  certificate region `us-east-1` are the intended production targets.
- Confirm control of DNS for `grapescrape.com`, including permission to create
  ACM validation CNAMEs and application A/AAAA aliases.
- Confirm the existing `api.grapescrape.com` and `auth.grapescrape.com` records
  still target the outputs from CM-35.
- Do not create GitHub secrets for the Cognito user-pool or app-client IDs.
  They are public identifiers read from stack outputs. Never put an access
  token, AWS credential, client secret, OpenAI key or other secret in a
  `VITE_` value.

Do not merge the first release until these checks are complete. The workflow is
supposed to change AWS after the protected merge; inspecting this pull request
does not authorize a manual local deployment.

### DURING the first CI deployment

Merge the approved PR to `main` and follow the `Deploy` workflow. Do not start a
second release while it is active.

The first certificate-stack deployment can wait for DNS validation of the new
`grapescrape.com` and `app.grapescrape.com` CloudFront certificate in
`us-east-1`. Retrieve pending records in ACM or with read-only AWS CLI calls:

```bash
aws acm list-certificates \
  --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='grapescrape.com'].[DomainName,CertificateArn]" \
  --output table

aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn REPLACE_WITH_FRONTEND_CERTIFICATE_ARN \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
  --output table
```

For every returned validation record, create exactly:

- name: the complete `_token.<domain>` returned by ACM;
- type: `CNAME`;
- target: the complete `_token.acm-validations.aws.` value;
- TTL: `300` seconds when the DNS provider requests one;
- routing: simple and DNS-only, never proxied.

Keep these CNAMEs permanently so ACM can renew the certificate. The job can
continue after ACM reports `ISSUED`. If Actions times out or fails while waiting,
leave the validation records in place and rerun the `Deploy` workflow with
`workflow_dispatch` on `main`. Do not use a local CDK deploy as a workaround.

After the certificate is valid, Actions deploys `GrapeScrapeFutureStack`,
validates its four required outputs and publishes the UI. A missing or `None`
output is a release failure; correct the stack/workflow problem and rerun on
`main` rather than substituting a hand-entered value in the workflow.

### AFTER the first CI deployment succeeds

Read the stack outputs for DNS and verification:

```bash
aws cloudformation describe-stacks \
  --region eu-west-2 \
  --stack-name GrapeScrapeFutureStack \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

Use `FrontendDistributionDomainName` as the target and
`FrontendDistributionHostedZoneId` (`Z2FDTNDATAQYW2`) as the alias hosted-zone
ID. In Route 53 create all four simple alias records:

| Name | Type | Alias target | Alias hosted-zone ID | Evaluate target health |
| --- | --- | --- | --- | --- |
| `app.grapescrape.com` | `A` | `FrontendDistributionDomainName` | `FrontendDistributionHostedZoneId` | No |
| `app.grapescrape.com` | `AAAA` | `FrontendDistributionDomainName` | `FrontendDistributionHostedZoneId` | No |
| `grapescrape.com` | `A` | `FrontendDistributionDomainName` | `FrontendDistributionHostedZoneId` | No |
| `grapescrape.com` | `AAAA` | `FrontendDistributionDomainName` | `FrontendDistributionHostedZoneId` | No |

Route 53 aliases do not use a TTL. At another DNS provider, use a CNAME for
`app` and an apex-safe `ALIAS`, `ANAME` or CNAME-flattening feature for the
root. Never create a normal CNAME at the zone apex.

Verify the existing records remain unchanged:

- `api.grapescrape.com`: A alias to `ApiDnsTarget` using
  `ApiDnsTargetHostedZoneId`, simple routing, target health disabled;
- `auth.grapescrape.com`: CNAME to `AuthDnsTarget`, TTL 300, DNS-only.

Finish the one-time Cognito managed-login settings in `eu-west-2`:

1. Open the `grapescrape-user-pool` managed-login branding editor and select
   the `grapescrape-user-pool-client` style.
2. Enable **Show logo**, select the deployed GrapeScrape `FORM_LOGO`, and apply
   it to the adaptive/dynamic colour-mode experience.
3. Select and preview the deployed GrapeScrape favicon.
4. Set page backgrounds to `#f4f3f0` light and `#1b1d1c` dark.
5. Set form backgrounds to `#fbfaf7` light and `#242725` dark.
6. Set the primary colour to `#157d6d` light and `#2f9d89` dark, with
   `#1b1d1c` light-mode text.
7. Use the managed system sans-serif typography; do not upload font binaries.
8. Confirm the logo is visible in sign-in, forgot-password, reset-password and
   error states at desktop and mobile widths, and that the favicon remains
   selected. Then save.

CDK owns the image assets but not Cognito's opaque editor settings. Repeat these
steps only if that branding style is rebuilt. Asset provenance and licensing
are recorded in `docs/branding/grapescrape-brand-assets.md`.

Finally, run the read-only checks below. Data mutation, SQS and OpenAI checks
remain a separate optional operation requiring new human approval.

## Production configuration and publication behavior

Actions supplies exactly seven public `VITE_` values. Five are fixed contracts:

```text
VITE_API_BASE_URL=https://api.grapescrape.com
VITE_COGNITO_AUTH_DOMAIN=https://auth.grapescrape.com
VITE_COGNITO_REGION=eu-west-2
VITE_COGNITO_CALLBACK_URL=https://app.grapescrape.com/auth/callback
VITE_COGNITO_LOGOUT_URL=https://app.grapescrape.com/
```

`VITE_COGNITO_USER_POOL_ID` comes from `UserPoolId`, and
`VITE_COGNITO_CLIENT_ID` comes from `UserPoolClientId`. The publication script
also receives `GRAPESCRAPE_FRONTEND_BUCKET` from `FrontendBucketName` and
`GRAPESCRAPE_FRONTEND_DISTRIBUTION_ID` from `FrontendDistributionId`.

The Cognito app client registers the callback and slash-terminated logout URLs
exactly. Values prefixed with `VITE_` are embedded in downloadable JavaScript
and must never be treated as secret storage.

The safe publication sequence is:

1. build and reject `src/ui/grapescrape_prototype.zip`, other prototype
   archives, `.dc.html`, `support.js`, screenshots and simulator/generated
   fixtures;
2. upload content-hashed `assets/*` first with
   `public, max-age=31536000, immutable`;
3. upload other non-index files without deleting old keys;
4. publish `index.html` last with `no-cache, no-store, must-revalidate`;
5. invalidate only `/index.html` after all uploads succeed.

CloudFront uses caching-optimized behavior only for `/assets/*`; the default
behavior disables edge caching for the entry point and other unhashed files.
Old hashed bundles remain available to open clients and rollback entry points.
Their later cleanup is a separately reviewed destructive operation.

## Read-only rollout checks

### Hosting, redirect, caching and headers

```bash
curl -I 'https://grapescrape.com/history?source=bookmark'
curl -I https://app.grapescrape.com/
curl -I https://app.grapescrape.com/history
curl -I https://app.grapescrape.com/assets/definitely-missing.js
```

Confirm:

- the apex returns `301` to
  `https://app.grapescrape.com/history?source=bookmark`;
- `/` and `/history` return application HTML without a redirect loop;
- a missing `.js` asset returns `403` or `404`, never `index.html`;
- responses include CSP, HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` and strict-origin referrer policy;
- `index.html` is no-store/no-cache and a real hashed asset is immutable for
  one year;
- browser developer tools show no CSP failures for Cognito/OAuth, API calls or
  Google Fonts.

### Authentication, CORS and API boundary

In a private browser session confirm:

1. a protected route redirects to the branded Cognito managed login;
2. public sign-up is unavailable;
3. sign-in returns through `/auth/callback` to the intended route;
4. logout returns to `https://app.grapescrape.com/` and protects the route;
5. forgot-password and reset-password complete in managed login;
6. an expired session returns to the normal sign-in flow;
7. `Authorization: Bearer ...` is sent only to `api.grapescrape.com`;
8. unauthenticated `GET /v1/auth/session` returns API Gateway 401;
9. authenticated `GET /v1/auth/session` succeeds and CORS allows only
   `https://app.grapescrape.com`;
10. an expired or tampered JWT is rejected with 401 and cannot select a
    client-supplied user identity.

### Responsive, accessible and read-only feature checks

At desktop and 390px widths confirm:

- no horizontal page scrolling;
- collapsed mobile navigation and reachable **Assess a wine** action;
- catalogue cards/rows, filter sheet and focus restoration work;
- saved palate, assessment history/detail and existing manual wines render;
- palate and manual-wine forms can be inspected without submitting;
- keyboard navigation, visible focus and labelled icon-only controls;
- reduced-motion behavior and usable contrast.

Browse only existing Home, catalogue, palate, history and manual-wine data.
Do not save a palate, create/edit/delete a manual wine, request reassessment,
request a manual-wine assessment, or call any write/enqueue API.

### Separately approved mutation and assessment checks

Palate saves and manual-wine changes mutate production data. Reassessment and
manual assessment creation call the assessment-request API, enqueue SQS and can
cause the assessor to call OpenAI. Test them only under a distinct later human
approval for production mutation, SQS work and OpenAI cost. Record approved
sources and expected assessment count before starting.

## Recovery, manual fallback and rollback

Prefer rerunning `Deploy` with `workflow_dispatch` on `main` after correcting a
transient permission, certificate or publication failure. The CDK deployment is
idempotent, and frontend publication does not replace `index.html` until all
required bundles have uploaded. Never run local CDK deploy as a first-release
workaround.

For an explicitly approved UI-only recovery, use the same safe script from a
known-good commit. Export the exact stack outputs and public production values:

```bash
stack_output() {
  aws cloudformation describe-stacks \
    --region eu-west-2 \
    --stack-name GrapeScrapeFutureStack \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

export GRAPESCRAPE_FRONTEND_BUCKET="$(stack_output FrontendBucketName)"
export GRAPESCRAPE_FRONTEND_DISTRIBUTION_ID="$(stack_output FrontendDistributionId)"
export VITE_COGNITO_USER_POOL_ID="$(stack_output UserPoolId)"
export VITE_COGNITO_CLIENT_ID="$(stack_output UserPoolClientId)"
export VITE_API_BASE_URL=https://api.grapescrape.com
export VITE_COGNITO_AUTH_DOMAIN=https://auth.grapescrape.com
export VITE_COGNITO_REGION=eu-west-2
export VITE_COGNITO_CALLBACK_URL=https://app.grapescrape.com/auth/callback
export VITE_COGNITO_LOGOUT_URL=https://app.grapescrape.com/
```

Then install exactly the locked dependencies and generate the dry run:

```bash
npm ci
npm run frontend:deploy
```

The default command rebuilds, scans prohibited artifacts and uses AWS CLI
`--dryrun` for every proposed upload. Review it before separately approving:

```bash
npm run frontend:deploy -- --execute
```

This manual fallback requires authorized production credentials and is not the
routine release path. It publishes hashed bundles before `index.html` and
invalidates only `/index.html`.

To roll back the UI, check out the last known-good commit, review that dry run
and republish it with explicit approval. Previously retained hashed bundles
remain available; the script uploads any missing bundles before restoring the
old entry point. Do not invalidate `/*` or delete old bundles as a shortcut.

For infrastructure rollback, revert the faulty change in a new reviewed PR and
let the normal `main` workflow deploy it. The frontend bucket is retained and
versioned. Never empty or delete it during rollback, and retain ACM validation
records throughout.

## Cost sanity and troubleshooting

The design uses S3 Standard storage and requests, a Price Class 100 CloudFront
distribution, CloudFront Function invocations and data transfer. Integrated,
non-exportable ACM certificates have no certificate charge. Each release
invalidates one path. Confirm current prices at the official
[CloudFront](https://aws.amazon.com/cloudfront/pricing/),
[S3](https://aws.amazon.com/s3/pricing/) and
[ACM](https://aws.amazon.com/certificate-manager/pricing/) pages. Monitor Cost
Explorer for unexpected transfer, request, function and retained-bundle storage
growth. Clean up old bundles only after proving no current or rollback entry
point references them.

| Symptom | Check |
| --- | --- |
| Deploy job is skipped | The run must use `refs/heads/main`; select `main` for manual dispatch. |
| OIDC assume-role fails | Verify `AWS_DEPLOY_ROLE_ARN`, account, role trust and protected-main subject. |
| Certificate deployment waits | Add every ACM validation CNAME exactly, keep it and ensure DNS proxying is off. |
| Output step fails | Verify CDK completed and all four required `GrapeScrapeFutureStack` outputs exist. |
| Frontend publication gets AccessDenied | Verify S3 list/put and CloudFront invalidation permissions on generated resources. |
| CloudFront certificate is invalid | The app/apex certificate must be `ISSUED` in `us-east-1` and include both names. |
| App returns S3 XML or 403 | Verify assets published to `FrontendBucketName` and the OAC bucket policy exists. |
| Deep link returns 403 | Verify the viewer-request function is published and associated with the default behavior. |
| Missing JavaScript returns HTML | Verify dotted and `/assets/*` requests are not rewritten. |
| OAuth callback or logout fails | Compare the Cognito and VITE URLs byte-for-byte, including the logout slash. |
| Token/API request is blocked | Inspect CSP and CORS; only the exact app origin is allowed. |
| Old UI remains | Inspect `index.html` cache control and `/index.html` invalidation status. |
| Branding remains default | Enable/select FORM_LOGO and favicon on the correct managed-login app-client style. |

The rollout succeeds when Actions completes CDK and frontend publication, both
domains have valid TLS, apex redirect and deep links work, missing assets do not
return HTML, cache/security headers are correct, branded auth and read-only
responsive checks pass, and costs show only expected hosting resources.
Mutating assessment checks are optional later operations with separate approval.

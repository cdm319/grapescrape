# Authenticated API domain setup

Use this runbook when deploying the CM-35 Cognito and HTTP API foundation.
The application resources are in `eu-west-2`; the Cognito custom-domain
certificate is in `us-east-1`.

> Warning: do not deploy from an unreviewed branch. This runbook documents
> deployment prerequisites; CM-35 implementation and validation do not deploy
> either stack.

## DNS ownership decision

The repository contains no Route 53 hosted-zone configuration for
`grapescrape.com`. The stacks therefore request DNS-validated certificates and
output service DNS targets, but do not create DNS records.

Before deployment, confirm where `grapescrape.com` DNS is managed:

```bash
aws sts get-caller-identity --query Account --output text
aws route53 list-hosted-zones-by-name \
  --dns-name grapescrape.com \
  --max-items 1 \
  --query 'HostedZones[?Name==`grapescrape.com.`]'
```

Expected outcome:

- if the exact public hosted zone exists in AWS account `668528910170`, a later
  change may manage its records in Route 53;
- otherwise, create the validation and service records with the external DNS
  provider.

Do not add Route 53 records until the account and hosted-zone ownership are
confirmed.

Before creating the Cognito custom domain, its parent domain must have a
resolvable `A` record. An SOA record alone is not sufficient:

```bash
dig A grapescrape.com +short
```

Expected outcome: at least one IP address is returned. If not, add a valid
parent-domain `A` record with the authoritative DNS provider before deploying
the application stack.

## Certificate validation

Synthesize both stacks from the repository root:

```bash
npm run cdk:synth
```

Expected outcome: templates are produced for:

- `GrapeScrapeAuthCertificateStack` in `us-east-1`;
- `GrapeScrapeFutureStack` in `eu-west-2`.

The certificate stack requests a certificate for `auth.grapescrape.com`. The
application stack requests one for `api.grapescrape.com`. During deployment,
ACM displays a CNAME name and value for each pending certificate. Create those
exact validation CNAMEs with the authoritative DNS provider and wait for both
certificates to reach `ISSUED`.

Verify status:

```bash
aws acm list-certificates \
  --region us-east-1 \
  --query 'CertificateSummaryList[?DomainName==`auth.grapescrape.com`]'

aws acm list-certificates \
  --region eu-west-2 \
  --query 'CertificateSummaryList[?DomainName==`api.grapescrape.com`]'
```

Use each returned ARN with `aws acm describe-certificate` and confirm:

```text
Certificate.Status = ISSUED
```

## Service DNS records

After the application stack has deployed, read its outputs:

```bash
aws cloudformation describe-stacks \
  --region eu-west-2 \
  --stack-name GrapeScrapeFutureStack \
  --query 'Stacks[0].Outputs'
```

Create:

| Name | Type | Target |
| --- | --- | --- |
| `auth.grapescrape.com` | `CNAME` | `AuthDnsTarget` output |
| `api.grapescrape.com` | `CNAME` | `ApiDnsTarget` output |

If the zone is later confirmed in the same Route 53 account, an alias record
for the API may use `ApiDnsTarget` and `ApiDnsTargetHostedZoneId`.

Wait for public DNS resolution and TLS validation:

```bash
dig +short auth.grapescrape.com
dig +short api.grapescrape.com
curl --silent --show-error \
  --output /dev/null \
  --write-out '%{http_code}\n' \
  https://api.grapescrape.com/v1/auth/session
```

Expected outcome:

- both names resolve to their AWS targets;
- TLS certificates match the requested names;
- the unauthenticated API request returns `401`, proving the route is
  protected.

Do not expect a successful login until the frontend at
`https://app.grapescrape.com` implements the configured
`https://app.grapescrape.com/auth/callback` flow.

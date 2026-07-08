# AGENTS.md

## Purpose

GrapeScrape is a Node.js/AWS CDK application that scrapes wine listings, tracks retailer stock state, and assesses wines against a user palate profile.

Agents should keep changes small, safe, and reviewable. Prefer candid technical feedback over agreement. Challenge designs when there is a simpler, safer, cheaper, or more maintainable alternative.

## Hard rules

- Do not run `cdk deploy`, `cdk destroy`, `npm run cdk:deploy`, or any command that mutates AWS resources unless explicitly instructed in the current task.
- Do not run migration scripts, one-off operational scripts, or commands that change production data unless explicitly instructed in the current task.
- Do not change production data directly.
- Do not modify, review, or rely on `old/` unless explicitly instructed. It is historical reference only.
- Do not add OpenAI calls outside the wine-assessor worker.
- Do not change `sourceHash` fields casually. Changing them can invalidate existing assessments and trigger unnecessary reassessment cost.
- Do not introduce TypeScript, new frameworks, new build systems, or broad rewrites unless explicitly asked.

When a task touches architecture, infrastructure, migrations, data models, idempotency, OpenAI-cost-affecting code, source hashing, scheduler frequency, SQS retry/DLQ behaviour, or DynamoDB table design, propose a short plan first and wait for confirmation.

Small, well-scoped implementation tasks may be completed directly. Agents should create focused commits with clear commit messages when they make changes.

## Repository structure

- `infra/` — AWS CDK infrastructure.
- `src/domain/` — pure domain logic only.
- `src/state/` — AWS state/integration adapters such as DynamoDB stores, SQS queue adapters, and SNS notifiers.
- `src/workers/` — Lambda workers and worker-specific integrations.
- `src/workers/retailer-scraper/` — retailer scraping worker. Owns retailer HTTP fetching, URL construction, CSV parsing, and retailer-specific mapping.
- `src/workers/wine-assessor/` — assessment worker. Owns OpenAI integration.
- `src/api/` — API Lambda handlers.
- `src/ui/` — frontend.
- `test/` — unit tests. The folder structure should recursively mirror `src/`.
- `old/` — historical reference only.

## npm and workspace rules

Run npm commands from the repository root.

Use:

```bash
npm install
npm install <package> --workspace <workspace-name>
npm test
npm run cdk:synth
npm run cdk:diff
```

Do not run `npm install` inside workspace directories.

There should be exactly one committed lockfile: the root `package-lock.json`. Do not create or commit nested package lockfiles such as `infra/package-lock.json`, `src/domain/package-lock.json`, `src/state/package-lock.json`, or `src/workers/*/package-lock.json`.

## Package boundary rules

`src/domain` must stay pure. It may contain wine normalisation, diffing, source hash creation, assessment key/request construction, assessment version constants, AWS/OpenAI-independent prompt construction, highlight/fit decision logic, and pure validation/transformation helpers.

`src/domain` must not contain AWS SDK code, OpenAI SDK code, HTTP fetching, CSV parsing, Lambda handlers, API Gateway event parsing, environment variable access, Secrets Manager access, DynamoDB/SQS/SNS concepts, or operational filesystem access.

`src/state` should hide AWS mechanics behind domain-specific operations. Prefer methods such as:

```js
wineStockStore.listCurrentWinesByRetailer(retailerId)
wineStockStore.upsertWineListings({ retailerId, wines })
wineStockStore.markListingsMissing({ retailerId, wines })
assessmentQueue.enqueueAssessmentRequests(requests)
```

Avoid leaking raw DynamoDB expressions, SQS commands, SNS publish commands, or AWS pagination details into worker orchestration code.

Workers orchestrate use cases. They may use domain helpers, state adapters, worker-specific integrations, and Lambda event parsing. Worker-specific external integrations should stay in the relevant worker package.

API handlers should deal with request parsing, authentication claims, validation, and response formatting. Shared business rules belong in `src/domain`; persistence and queue interactions belong behind `src/state` adapters.

## Dependency rules

Do not add runtime dependencies without explaining why.

Worker-specific dependencies belong in that worker package. For example, `csv-parse` belongs in `@grapescrape/retailer-scraper`, not `@grapescrape/domain`.

AWS SDK clients generally belong in `@grapescrape/state`, unless there is a specific worker-only reason.

Do not add dependencies to `@grapescrape/domain` unless they are truly domain-level, lightweight, and justified.

## Testing and validation

Agents should unit test any code changes they make, except for `infra` changes.

Tests live in the top-level `test/` directory and should recursively mirror `src/`:

```txt
src/domain/wine/createSourceHash.js
 test/domain/wine/createSourceHash.test.js

src/workers/retailer-scraper/scrapeRetailers.js
 test/workers/retailer-scraper/scrapeRetailers.test.js

src/state/sqs/assessmentQueue.js
 test/state/sqs/assessmentQueue.test.js
```

When changing pure domain logic, add or update unit tests. When changing workers, unit test orchestration by injecting fake dependencies where practical. When changing state adapters, unit test request construction and error handling where practical without excessive AWS SDK mocking.

For `infra` changes, agents do not need unit tests but must run or ask the user to run:

```bash
npm run cdk:synth
```

When useful, agents may also run:

```bash
npm run cdk:diff
```

Before claiming work is complete, state what tests were added or updated, what commands were run, and what was not run.

## AWS, cost, and data safety

Agents may run CDK synth/diff commands. They must not deploy, destroy, run migrations, run operational scripts, or mutate AWS resources/data unless explicitly instructed in the current task.

Use `RemovalPolicy.RETAIN` for persistent application data tables unless explicitly instructed otherwise.

Do not enable schedules, event sources, recurring jobs, or queue consumers without calling this out clearly.

Be especially careful with:

- OpenAI assessment calls
- assessment idempotency
- `sourceHash`
- assessment versioning
- palate profile versioning
- SQS retry/DLQ behaviour
- EventBridge schedule frequency
- DynamoDB table design and removal policies

Agents may change these areas when directly instructed, but should first state the risk and intended approach.

Do not increase schedule frequency, Lambda timeout, SQS retry behaviour, or concurrency limits without calling out cost and operational impact.

## Source hash and assessment rules

`sourceHash` represents the wine fields that affect assessment output. When changing `createSourceHash`, explain why the field list is changing, whether existing assessments will become stale, and the expected reassessment/cost impact. Update tests. Do not include price in `sourceHash` unless explicitly instructed.

The wine assessor is the only component that should call OpenAI. Before calling OpenAI for an assessment, the worker must establish idempotency using a deterministic assessment key based on user ID, source key, palate profile version, assessment version, and source hash. Use conditional writes or equivalent safeguards so duplicate SQS deliveries do not cause duplicate OpenAI calls.

OpenAI request/response handling should be isolated inside the wine-assessor worker. Shared assessment decision logic belongs in `src/domain`.

## Code style

Use JavaScript ESM. Use `.js` extensions for relative ESM imports.

For workspace package subpath imports, follow each package's `exports` map. Do not add `.js` to workspace package imports unless the export explicitly requires it.

Prefer small modules with direct imports. Avoid broad barrel imports that may bloat Lambda bundles.

Validate required environment variables or injected configuration at composition boundaries.

## Change discipline

Keep changes focused. Do not mix unrelated refactors with behaviour changes.

For large tasks:

1. Summarise the intended change.
2. Identify files likely to change.
3. Call out risks.
4. Implement incrementally.
5. Add or update tests.
6. Run relevant validation.
7. Summarise what changed and what remains.

Use clear, specific commit messages such as:

```txt
Add WineStock DynamoDB store
Move retailer CSV parsing into scraper worker
Add source hash tests
Wire retailer scraper Lambda infrastructure
```

## Current architecture notes

Retailer scraper flow:

```txt
EventBridge Scheduler
  -> retailer-scraper Lambda
    -> fetch retailer listings
    -> diff against WineStock DynamoDB current listings
    -> upsert current listings
    -> mark removed listings missing
    -> publish SNS notification
    -> enqueue new assessment requests to SQS
```

Wine assessor flow:

```txt
SQS assessment queue
  -> wine-assessor Lambda
    -> validate message
    -> create deterministic assessment key
    -> conditionally create/claim assessment record
    -> call OpenAI only when assessment is not already completed/in progress
    -> persist assessment result
    -> emit notification if relevant
```

Prefer AWS-native managed services and simple serverless primitives before adding heavier services. Use DynamoDB as the operational data store. Use S3 for static UI assets and raw/archive data where appropriate. Use OpenSearch only if DynamoDB/client-side filtering becomes insufficient for search.

When uncertain, ask before making broad changes. If a change could affect cost, production data, architecture, or assessment correctness, stop and propose a plan first.

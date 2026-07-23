# Authenticated web application and API contracts

Status: agreed architecture for CM-34.

This document is the implementation contract for the first authenticated
GrapeScrape web application. Later tickets may add implementation detail, but
must not silently change the routes, schemas, identity boundary, or product
semantics defined here.

## Scope and system shape

The first release has one production environment and these public domains:

| Domain | Responsibility |
| --- | --- |
| `app.grapescrape.com` | React, TypeScript and Vite single-page application |
| `auth.grapescrape.com` | Cognito managed login |
| `api.grapescrape.com` | API Gateway HTTP API |

The frontend is built as static assets and hosted from S3 through CloudFront.
S3 is not a public website endpoint. CloudFront serves the application and
maps unknown application paths to the SPA entry point without converting
missing static assets into HTML responses.

The API is one API Gateway HTTP API with a Cognito JWT authorizer and separate
Lambda functions by domain:

- palate profile;
- catalogue;
- assessed-wine history and assessment requests;
- manual wines.

Business rules shared by those Lambdas belong in `src/domain`; DynamoDB and SQS
mechanics remain behind `src/state` adapters. The wine-assessor worker remains
the only component that calls OpenAI.

Application resources run in `eu-west-2`. The ACM certificate required by the
Cognito custom domain is created in `us-east-1`. Infrastructure tickets may
refine resource names and deployment mechanics without changing these public
contracts.

## Authentication and user identity

Cognito managed login uses the authorization-code flow with PKCE. Public
sign-up is disabled, password reset is enabled, and MFA is not required for the
first release. The React application must not implement its own password form
or handle user passwords.

Every `/v1` route below is protected by the HTTP API JWT authorizer. The API
derives `userId` only from the validated access token's `sub` claim:

```text
userId = requestContext.authorizer.jwt.claims.sub
```

The API must validate the configured issuer and application-client audience.
An absent, expired, malformed, or incorrectly issued token is rejected before
the Lambda integration. API Gateway HTTP API returns its standard `401
{"message":"Unauthorized"}` response for this case, and the frontend normalises
that response to `UNAUTHENTICATED`.

No public path, query parameter, or request body accepts `userId`.

- A `userId` field in a JSON body or query string is rejected as
  `400 INVALID_REQUEST`.
- User-identity headers such as `X-User-Id` are ignored and have no security
  meaning.
- State queries and writes always add the token-derived `userId` server-side.
- Logs may include stable request and record IDs, but must not include access
  tokens or arbitrary exception messages.

Browser CORS permits the exact origin `https://app.grapescrape.com`, the
required methods and headers, and no wildcard origin. Authentication redirects
allow only configured application callback and logout URLs.

## HTTP and JSON conventions

### Paths, media type and time

- The public API prefix is `/v1`.
- Requests and responses use `application/json; charset=utf-8`.
- Property names use `camelCase`.
- Timestamps are UTC RFC 3339 strings, for example
  `2026-07-23T10:30:00.000Z`.
- Identifiers, hashes, enum values and cursor values are strings.
- Unknown request fields are rejected rather than silently persisted.
- An absent optional value is omitted from a request and represented as `null`
  in a response when the schema declares the property nullable.
- The server assigns entity IDs, versions and timestamps unless a route says
  otherwise.

### Success envelope

Every successful response, including soft deletion, is JSON:

```json
{
  "data": {},
  "meta": {
    "requestId": "api-gateway-request-id"
  }
}
```

List responses add pagination metadata:

```json
{
  "data": {
    "items": []
  },
  "meta": {
    "requestId": "api-gateway-request-id",
    "nextCursor": null
  }
}
```

`meta.requestId` is the HTTP request correlation ID. It is distinct from the
assessment-request IDs returned by `POST /v1/assessment-requests`.

### Error envelope

All expected and unexpected errors returned by Lambda integrations use one
safe shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request did not pass validation.",
    "details": [
      {
        "field": "profile.wineExamples[0].name",
        "reason": "must be between 1 and 120 characters"
      }
    ]
  },
  "meta": {
    "requestId": "api-gateway-request-id"
  }
}
```

`details` is optional and contains only stable, client-actionable values. Raw
AWS, Cognito, DynamoDB, SQS or OpenAI errors are never returned.

The sole envelope exception is a `401` generated directly by the HTTP API JWT
authorizer before a request reaches Lambda. API Gateway returns
`{"message":"Unauthorized"}` for that response and does not support REST API
gateway-response templates for HTTP APIs. Frontends must treat it as
`UNAUTHENTICATED`.

Common errors are:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Malformed JSON, unknown fields or invalid query combinations |
| 400 | `VALIDATION_FAILED` | A known field fails schema or product validation |
| 400 | `INVALID_CURSOR` | Cursor is malformed or does not match the current query |
| 401 | `UNAUTHENTICATED` | Access token is absent or invalid |
| 404 | route-specific code | The authenticated user's resource does not exist |
| 409 | route-specific code | Optimistic-concurrency or uniqueness conflict |
| 429 | `RATE_LIMITED` | Caller should retry using `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected failure with no internal detail exposed |
| 503 | `DEPENDENCY_UNAVAILABLE` | A required managed service is temporarily unavailable |

### Pagination

All list routes use opaque cursor pagination:

- `limit` defaults to `25`, has a minimum of `1`, and a maximum of `100`;
- `cursor` is omitted for the first page;
- `meta.nextCursor` is `null` when no next page exists;
- cursors are opaque, URL-safe and must not be decoded or constructed by
  clients;
- a cursor binds the last evaluated key, sort, direction and filters so it
  cannot be reused with a different query;
- every sort has a stable ID tie-breaker to prevent duplicate or skipped rows;
- offset/page-number pagination is not supported.

## Shared domain contracts

### Canonical vintage and wine identity

A manually entered wine or profile example uses a canonical `vintage` token:

- a four-digit year from `1000` through `2999`; or
- the exact uppercase value `NV`.

Values such as `nv`, `N/V`, an empty string or a numeric JSON value are
rejected.

For uniqueness, a name is normalised with Unicode NFKC, leading and trailing
whitespace removal, internal whitespace collapse to one space, and
locale-independent lowercase conversion. Punctuation and accents are
preserved. The uniqueness identity is:

```text
normalisedName + "\u0000" + canonicalVintage
```

The NUL separator prevents ambiguous concatenation. The normalised value is an
internal key and is not returned as a display name.

Retailer sources retain their established key:

```text
retailer:<retailerId>:<wineId>
```

Manual wines use a server-generated UUID and stable key:

```text
manual:<uuid>
```

`sourceKey` path parameters are URL-encoded as one path segment.

### Fit and confidence

APIs return the canonical stored enum values. Prototype-only numeric levels or
confidence scores such as `0.88` are not part of the domain or public
presentation contract.

Fit order, best to worst:

| Value | Filter/sort rank | Label |
| --- | ---: | --- |
| `strong` | 4 | Strong fit |
| `good` | 3 | Good fit |
| `maybe` | 2 | Maybe |
| `poor` | 1 | Poor fit |

Confidence order, highest to lowest:

| Value | Filter/sort rank | Label |
| --- | ---: | --- |
| `high` | 4 | High |
| `medium_high` | 3 | Medium-high |
| `medium` | 2 | Medium |
| `low` | 1 | Low |

Unassessed wines have neither fit nor confidence and sort after assessed wines
for both ascending and descending fit/confidence sorts. Existing values such as
`maybe` and `medium_high` must not be renamed or collapsed in API adapters.

### Structured palate profile

Each profile version is immutable and has this response shape:

```json
{
  "palateProfileVersion": 4,
  "stylePreferences": {
    "body": {
      "preferred": ["medium_plus", "full"],
      "avoided": ["light"]
    },
    "fruitRipeness": {
      "preferred": ["ripe", "very_ripe"],
      "avoided": ["underripe"]
    },
    "fruitCharacter": {
      "preferred": ["black_fruit", "plum"],
      "avoided": []
    },
    "texture": {
      "preferred": ["plush", "velvety"],
      "avoided": ["austere", "thin"]
    },
    "oakInfluence": {
      "preferred": ["moderate", "pronounced"],
      "avoided": ["none_detected"]
    },
    "tannin": {
      "preferred": ["moderate", "moderate_plus"],
      "avoided": ["firm_or_drying"]
    },
    "acidity": {
      "preferred": ["balanced", "fresh"],
      "avoided": ["sharp"]
    },
    "development": {
      "preferred": ["ready_to_drink", "developing"],
      "avoided": []
    },
    "styleTags": {
      "preferred": ["fruit_forward", "opulent", "polished"],
      "avoided": ["rustic"]
    }
  },
  "wineExamples": [
    {
      "id": "c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234",
      "name": "Example Estate",
      "vintage": "2019",
      "sentiment": "enjoyed",
      "notes": "Ripe fruit and a plush texture."
    }
  ],
  "createdAt": "2026-07-23T10:30:00.000Z",
  "updatedAt": "2026-07-23T10:30:00.000Z"
}
```

Every style dimension is required. `preferred` and `avoided` are arrays with no
duplicates and no value may appear in both arrays for one dimension. Empty
arrays are valid. Because a profile version is immutable, its `createdAt` and
`updatedAt` values are equal; `updatedAt` is retained as a UI-facing name for
the current profile's update time.

The allowed style values match the wine-assessment domain:

| Dimension | Allowed values |
| --- | --- |
| `body` | `light`, `medium_minus`, `medium`, `medium_plus`, `full` |
| `fruitRipeness` | `underripe`, `fresh`, `ripe`, `very_ripe`, `jammy` |
| `fruitCharacter` | `red_fruit`, `black_fruit`, `dark_fruit`, `blackcurrant`, `blackberry`, `plum`, `black_cherry`, `red_cherry`, `dried_fruit`, `cranberry` |
| `texture` | `supple`, `silky`, `velvety`, `plush`, `fleshy`, `generous`, `polished`, `firm`, `lean`, `austere`, `thin` |
| `oakInfluence` | `none_detected`, `subtle`, `moderate`, `pronounced` |
| `tannin` | `low`, `moderate`, `moderate_plus`, `high`, `firm_or_drying` |
| `acidity` | `low`, `balanced`, `fresh`, `high`, `sharp` |
| `development` | `youthful`, `ready_to_drink`, `developing`, `mature` |
| `styleTags` | `fruit_forward`, `classic`, `modern`, `traditional`, `opulent`, `approachable`, `structured`, `rustic`, `elegant`, `spicy`, `earthy`, `savoury`, `unoaked`, `oak_influenced`, `chillable`, `food_wine`, `polished` |

`unknown` is valid in an assessment inference but not as a user's stated
preference.

A wine example has exactly `id`, `name`, `vintage`, `sentiment` and `notes`:

- `id` is a UUID created by the client before the profile update and remains
  stable across later profile versions;
- `name` is trimmed and contains 1 to 120 characters;
- `vintage` follows the canonical vintage contract;
- `sentiment` is `enjoyed` or `not_enjoyed`;
- `notes` is a string from 0 to 400 characters;
- no more than 20 examples may be `enjoyed` and no more than 20 may be
  `not_enjoyed`;
- IDs are unique within the profile;
- normalised name plus vintage is unique across both sentiment groups, so a
  wine cannot be duplicated or appear in both;
- examples are only entered by the user; catalogue and assessment records are
  never copied into the profile automatically.

Only an example's `name`, `vintage`, `sentiment` and `notes` are included in the
OpenAI palate context. Its `id`, timestamps, user identity and storage metadata
are not.

### Assessment

A completed public assessment has this shape:

```json
{
  "assessmentInputKey": "sha256-hex-value",
  "sourceKey": "retailer:tws:12345",
  "assessmentVersion": 3,
  "palateProfileVersion": 4,
  "fit": "good",
  "confidence": "medium_high",
  "highlight": true,
  "headline": "Ripe and polished",
  "summary": "A likely match for the current palate.",
  "reasoningMode": "metadata_plus_description",
  "reasons": ["Ripe black-fruit profile."],
  "cautions": ["Tannin level is inferred."],
  "evidence": [
    {
      "type": "direct",
      "source": "wine.description",
      "text": "The description identifies ripe black fruit."
    }
  ],
  "assumptions": [],
  "palateAlignment": {
    "fruit": "positive",
    "texture": "positive",
    "oakAndDevelopment": "mixed",
    "structure": "neutral",
    "overall": "good"
  },
  "styleProfile": {
    "body": "medium_plus",
    "fruitRipeness": "ripe",
    "fruitCharacter": ["black_fruit"],
    "texture": ["polished"],
    "oakInfluence": "moderate",
    "tannin": "moderate_plus",
    "acidity": "balanced",
    "development": "ready_to_drink",
    "styleTags": ["fruit_forward", "polished"]
  },
  "completedAt": "2026-07-23T10:30:00.000Z"
}
```

Assessment fields have these constraints:

| Field | Contract |
| --- | --- |
| `fit` | Canonical fit enum |
| `confidence` | Canonical confidence enum |
| `highlight` | Boolean |
| `headline` | String; nullable only for migrated historic records |
| `summary` | String; nullable only for migrated historic records |
| `reasoningMode` | `description_only`, `metadata_plus_description`, `metadata_plus_description_plus_general_knowledge` or `insufficient_evidence` |
| `reasons` | 1 to 5 strings |
| `cautions` | 0 to 5 strings |
| `evidence` | 1 to 8 evidence objects |
| `assumptions` | 0 to 5 strings |
| `palateAlignment` | Required alignment object |
| `styleProfile` | Required inferred-style object |

An evidence object has exactly `type`, `source` and `text`. `type` is `direct`
or `inferred`. `source` is one of `wine.name`, `wine.region`, `wine.vintage`,
`wine.grape`, `wine.alcohol`, `wine.description` or
`general_wine_knowledge`.

`palateAlignment` has exactly `fruit`, `texture`, `oakAndDevelopment`,
`structure` and `overall`. The first four fields are `positive`, `mixed`,
`neutral`, `caution` or `unknown`; `overall` is a canonical fit value.

`styleProfile` uses the structured-profile dimension values above, with
`unknown` additionally allowed for every inferred scalar and array. Its
`fruitCharacter` array has 0 to 10 values, `texture` has 0 to 8, and
`styleTags` has 0 to 10.

These constraints must remain in sync with
`src/domain/assessment/wineAssessmentSchema.js`. The API exposes stored values
without translating them into prototype-only categories.

Assessments are immutable and cannot be deleted. The API does not expose model
names, raw prompts, raw provider responses, storage keys, source hashes or
arbitrary provider errors.

### Assessment freshness

Fit and freshness are separate. The latest assessment keeps its original fit,
confidence and explanation even when it is stale.

Every catalogue and assessed-wine representation includes:

```json
{
  "freshness": {
    "status": "palate_profile_changed",
    "isCurrent": false,
    "profileChanged": true,
    "sourceChanged": false,
    "assessedPalateProfileVersion": 3,
    "currentPalateProfileVersion": 4
  }
}
```

`status` is derived at read time:

| Status | Meaning |
| --- | --- |
| `current` | Latest assessment profile version and source hash both match current state |
| `palate_profile_changed` | Only the current palate-profile version differs |
| `source_changed` | Only the current source hash differs |
| `palate_profile_and_source_changed` | Both profile version and source hash differ |
| `unassessed` | No completed assessment exists for this user and source |

For `unassessed`, `isCurrent`, `profileChanged` and `sourceChanged` are `false`;
`assessedPalateProfileVersion` is `null`; and
`currentPalateProfileVersion` is the current version or `null` if the user has
not created a profile.

Removal and freshness are independent. A removed retailer listing or deleted
manual wine retains its last known source data, so an historic assessment may
still be `current` relative to that data while the wine's availability says it
is removed or deleted.

`sourceChanged` means the assessment's stored `sourceHash` differs from the
current source record's hash:

- retailer wine hashing keeps the established canonical property order
  `name`, `vintage`, `region`, `alcohol` from
  `src/domain/wine/createSourceHash.js`; price, grape and description are not
  part of retailer freshness;
- a manual-wine hash is SHA-256 over canonical JSON containing `name`,
  `vintage` and `description` in that property order, so an edited description
  makes an earlier manual assessment stale;
- changing a hash contract is a separate, cost-sensitive decision and must not
  be hidden in an API implementation ticket.

### Assessed wine

History groups immutable assessments under their stable `sourceKey`. An
assessed-wine response has:

| Field | Contract |
| --- | --- |
| `sourceKey` | Stable retailer or manual source key |
| `sourceType` | `retailer` or `manual` |
| `wine` | Display identity, availability and current-price object described below |
| `latestAssessment` | Complete public assessment object |
| `freshness` | Complete derived freshness object |
| `assessmentCount` | Positive integer count of completed assessments |
| `lastAssessedAt` | Latest completion timestamp |

The `wine` object contains `name`, `vintage`, nullable `region`, `grape`,
`alcohol` and `description`, `availability`, and nullable `currentPrice`.
`currentPrice`, when present, contains a two-decimal string `amount` and
`currency: "GBP"`.

`availability` is one of `current_retailer`, `removed_retailer`,
`active_manual` or `deleted_manual`.

For a current retailer wine, `currentPrice` comes from the current WineStock
record. For a removed retailer wine or any manual wine it is `null`.
Assessment-snapshot price must never be returned or labelled as current price.
Other identity fields fall back to the latest assessment snapshot when the live
source is removed or deleted.

### Manual wine

A manual wine is persisted separately from retailer stock:

```json
{
  "id": "ffbd54ef-0c8e-49c7-a98e-e6703c08410e",
  "sourceKey": "manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e",
  "name": "Cellar Example",
  "vintage": "NV",
  "description": "Rich red fruit with soft tannins.",
  "status": "active",
  "createdAt": "2026-07-23T10:00:00.000Z",
  "updatedAt": "2026-07-23T10:00:00.000Z",
  "deletedAt": null,
  "latestAssessment": null,
  "freshness": {
    "status": "unassessed",
    "isCurrent": false,
    "profileChanged": false,
    "sourceChanged": false,
    "assessedPalateProfileVersion": null,
    "currentPalateProfileVersion": 4
  }
}
```

Validation and lifecycle:

- `name` is trimmed and contains 1 to 120 characters;
- `vintage` follows the canonical vintage contract;
- `description` is a string from 0 to 2,000 characters;
- normalised name plus vintage is unique among all active and deleted manual
  wines for the user;
- `name` and `vintage` are immutable after creation;
- `description` is editable;
- deletion sets `status` to `deleted` and records `deletedAt`;
- there is no undelete route in the first release;
- deleted wines do not appear in the normal manual-wine list and cannot be
  edited or assessed;
- deleted wines and their display identity remain available through historic
  assessed-wine routes;
- creating a wine does not automatically request an assessment.

## Public routes

### Route summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/auth/session` | Confirm the token-derived authenticated subject |
| `GET` | `/v1/palate-profile` | Read the current immutable profile version |
| `PUT` | `/v1/palate-profile` | Create the next profile version |
| `GET` | `/v1/catalogue/wines` | Search current retailer listings |
| `GET` | `/v1/catalogue/wines/{sourceKey}` | Read one current retailer listing |
| `GET` | `/v1/assessed-wines` | Search wines with completed assessments |
| `GET` | `/v1/assessed-wines/{sourceKey}` | Read assessed-wine summary |
| `GET` | `/v1/assessed-wines/{sourceKey}/assessments` | List completed assessments for one wine |
| `GET` | `/v1/assessed-wines/{sourceKey}/assessments/{assessmentVersion}` | Read one completed version and poll for completion |
| `POST` | `/v1/assessment-requests` | Assess or reassess 1 to 25 wines |
| `GET` | `/v1/manual-wines` | List active manual wines |
| `POST` | `/v1/manual-wines` | Create a manual wine |
| `GET` | `/v1/manual-wines/{manualWineId}` | Read an active manual wine |
| `PATCH` | `/v1/manual-wines/{manualWineId}` | Edit a manual-wine description |
| `DELETE` | `/v1/manual-wines/{manualWineId}` | Soft-delete a manual wine |

No generic Home or activity route is introduced for the first release.

### `GET /v1/auth/session`

This infrastructure diagnostic route verifies the Cognito JWT authorizer and
the API identity boundary before domain routes are added.

Request: no body or query parameters.

Response: `200` with only the token-derived subject:

```json
{
  "data": {
    "subject": "5682e224-80d1-7027-767b-0617ac74683f"
  },
  "meta": {
    "requestId": "api-gateway-request-id"
  }
}
```

No email address, token, token metadata or other claim is returned. Missing or
invalid tokens are rejected by the HTTP API JWT authorizer with its standard
`401 {"message":"Unauthorized"}` response.

### `GET /v1/palate-profile`

Request: no body or query parameters.

Response: `200` with the current structured palate profile as `data`.

Errors:

- `404 PALATE_PROFILE_NOT_FOUND` when the authenticated user has no profile;
- common authentication and server errors.

### `PUT /v1/palate-profile`

Request:

```json
{
  "expectedPalateProfileVersion": 3,
  "profile": {
    "stylePreferences": {
      "body": {
        "preferred": ["medium_plus", "full"],
        "avoided": ["light"]
      },
      "fruitRipeness": {
        "preferred": ["ripe"],
        "avoided": ["underripe"]
      },
      "fruitCharacter": {
        "preferred": ["black_fruit"],
        "avoided": []
      },
      "texture": {
        "preferred": ["plush"],
        "avoided": ["austere"]
      },
      "oakInfluence": {
        "preferred": ["moderate"],
        "avoided": []
      },
      "tannin": {
        "preferred": ["moderate_plus"],
        "avoided": ["firm_or_drying"]
      },
      "acidity": {
        "preferred": ["balanced"],
        "avoided": ["sharp"]
      },
      "development": {
        "preferred": ["ready_to_drink"],
        "avoided": []
      },
      "styleTags": {
        "preferred": ["fruit_forward", "polished"],
        "avoided": ["rustic"]
      }
    },
    "wineExamples": [
      {
        "id": "c5f751e0-cd3c-4b5b-9cf7-fd86d9acc234",
        "name": "Example Estate",
        "vintage": "2019",
        "sentiment": "enjoyed",
        "notes": "Ripe fruit and a plush texture."
      }
    ]
  }
}
```

`profile` contains the complete `stylePreferences` and `wineExamples` shapes
defined above. Partial profile updates are not supported. To create the first
profile, `expectedPalateProfileVersion` must be `null`; otherwise it is the
positive integer version last read by the client.

The API validates the whole proposed profile, assigns the next positive integer
version, writes an immutable version item and updates the current pointer in
one DynamoDB transaction. The pointer update is conditional on
`expectedPalateProfileVersion`. No existing version is overwritten.

Response: `200` with the newly current profile as `data`.

Errors:

- `400 VALIDATION_FAILED` for schema, enum, example limit or duplicate errors;
- `409 PROFILE_VERSION_CONFLICT` with
  `details.currentPalateProfileVersion` when another update won the race;
- common authentication and server errors.

Updating a profile does not enqueue catalogue or manual-wine assessments.

### `GET /v1/catalogue/wines`

Request query:

| Parameter | Contract |
| --- | --- |
| `q` | Optional 1-120 character identity search over name, vintage, retailer and region; never assessment prose |
| `retailerId` | Optional exact retailer ID |
| `fit` | Optional comma-separated canonical fit values |
| `confidence` | Optional comma-separated canonical confidence values |
| `freshness` | Optional comma-separated freshness statuses |
| `sort` | `first_seen`, `price`, `name`, `fit` or `confidence`; default `name` |
| `direction` | `asc` or `desc`; default `desc` for `first_seen`, otherwise `asc` |
| `limit` | Shared pagination limit |
| `cursor` | Shared opaque cursor |

Only current retailer listings are returned. `first_seen` sorts by
`firstSeenAt`; catalogue representations always expose both `firstSeenAt` and
`lastSeenAt`. Fit/confidence filters exclude unassessed wines unless the
separate `freshness=unassessed` filter is used.

Response: `200` list envelope. Each item contains:

- `sourceKey`, retailer ID and retailer wine ID;
- name, vintage, region, grape, alcohol and description;
- `currentPrice` with decimal-string `amount` and `GBP` currency;
- `firstSeenAt` and `lastSeenAt`;
- `latestAssessment`, nullable;
- derived `freshness`.

Errors:

- `400 INVALID_REQUEST`, `VALIDATION_FAILED` or `INVALID_CURSOR` for invalid
  query values;
- common authentication and server errors.

### `GET /v1/catalogue/wines/{sourceKey}`

Request: URL-encoded retailer `sourceKey`; no body or query.

Response: `200` with one catalogue representation as `data`.

Errors:

- `400 INVALID_REQUEST` when the key is not a retailer key;
- `404 CATALOGUE_WINE_NOT_FOUND` when the listing does not exist or is no longer
  current;
- common authentication and server errors.

### `GET /v1/assessed-wines`

Request query:

| Parameter | Contract |
| --- | --- |
| `q` | Optional 1-120 character search over wine identity fields, not assessment prose |
| `sourceType` | `retailer` or `manual` |
| `availability` | Comma-separated availability values |
| `fit` | Comma-separated canonical fit values |
| `confidence` | Comma-separated canonical confidence values |
| `freshness` | Comma-separated freshness statuses |
| `completedFrom` | Optional inclusive RFC 3339 timestamp |
| `completedTo` | Optional inclusive RFC 3339 timestamp |
| `sort` | `last_assessed`, `name`, `fit` or `confidence`; default `last_assessed` |
| `direction` | `asc` or `desc`; default `desc` |
| `limit` | Shared pagination limit |
| `cursor` | Shared opaque cursor |

The result has one item per `sourceKey`, based on that source's latest completed
assessment. Full-text searching over headline, summary, reasons, cautions or
evidence is not supported.

Response: `200` list envelope containing assessed-wine summaries.

Errors:

- `400 INVALID_REQUEST`, `VALIDATION_FAILED` or `INVALID_CURSOR` for invalid
  query values;
- common authentication and server errors.

### `GET /v1/assessed-wines/{sourceKey}`

Request: URL-encoded retailer or manual `sourceKey`; no body or query.

Response: `200` with the assessed-wine summary, including the latest completed
assessment, derived freshness and assessment count.

Errors:

- `400 INVALID_REQUEST` for an invalid source key;
- `404 ASSESSED_WINE_NOT_FOUND` when the user has no completed assessment for
  that source;
- common authentication and server errors.

### `GET /v1/assessed-wines/{sourceKey}/assessments`

Request: URL-encoded source key plus shared `limit` and `cursor` query
parameters. Assessments sort by `assessmentVersion` descending, then
`assessmentInputKey` descending.

Response: `200` list envelope containing completed public assessment objects.

Errors:

- `400 INVALID_REQUEST` or `INVALID_CURSOR`;
- `404 ASSESSED_WINE_NOT_FOUND` when no completed assessment exists for that
  source;
- common authentication and server errors.

### `GET /v1/assessed-wines/{sourceKey}/assessments/{assessmentVersion}`

Request: URL-encoded source key and positive integer `assessmentVersion`; no
body or query.

Response: `200` with the exact completed public assessment as `data`. This is
also the polling target after an assessment request.

Errors:

- `400 INVALID_REQUEST` for an invalid key or version;
- `404 ASSESSMENT_NOT_FOUND` when that version has not completed, does not
  exist, or does not belong to the authenticated user;
- common authentication and server errors.

The route intentionally cannot distinguish queued, processing, failed and
never-requested versions because the first release has no durable
request-status record.

### `POST /v1/assessment-requests`

This route is used for an initial assessment and every later reassessment.

Request:

```json
{
  "sourceKeys": [
    "retailer:tws:12345",
    "manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e"
  ]
}
```

`sourceKeys` contains 1 to 25 unique retailer or manual source keys. The API
validates all keys before allocating or enqueuing anything. Retailer sources
must exist; manual sources must belong to the authenticated user and be active.
A current palate profile must exist.

For every source, the API:

1. atomically allocates the next `assessmentVersion` for the derived
   `userId + sourceKey`;
2. creates a UUID `requestId`;
3. snapshots the current source and source hash;
4. enqueues one existing `AssessmentRequested` message containing the derived
   user ID, request ID, source, wine snapshot, source hash and allocated
   assessment version.

The version allocation for all requested sources is one transaction. Queue
messages remain one message per wine; this API does not create a new bulk
worker message type.

Success response: `202`:

```json
{
  "data": {
    "requests": [
      {
        "sourceKey": "retailer:tws:12345",
        "requestId": "93985b81-67c5-4bb1-b5ce-380134db6baa",
        "assessmentVersion": 3
      }
    ]
  },
  "meta": {
    "requestId": "api-gateway-request-id"
  }
}
```

Errors:

- `400 VALIDATION_FAILED` for an empty list, more than 25 keys, duplicates or
  invalid source-key syntax;
- `404 PALATE_PROFILE_NOT_FOUND` when no current profile exists;
- `404 ASSESSMENT_SOURCE_NOT_FOUND` with the invalid keys in safe `details`
  when any retailer source is missing or any manual source is missing, deleted
  or owned by another user; no versions are allocated in this case;
- `503 ASSESSMENT_QUEUE_UNAVAILABLE` when allocation succeeded but one or more
  queue writes failed. Safe `details` returns `queued` request/version tuples
  and `notQueued` source/version tuples so the frontend polls only queued
  entries and retries only `notQueued` sources.

Allocated versions are strictly increasing positive integers for one
`userId + sourceKey`, but need not be contiguous: a failed enqueue may consume
a version. Clients never supply or predict a version. `assessmentVersion`
means a server-allocated assessment attempt for that user and source; it is not
the palate version, prompt version, schema version or model version.

The worker resolves the current palate profile at processing time. In
particular, a manual-wine request never pins the profile version that happened
to be current when the API accepted the request. The deterministic assessment
input key continues to use the exact existing inputs: derived user ID, source
key, resolved palate-profile version, allocated assessment version and source
hash.

### `GET /v1/manual-wines`

Request query:

| Parameter | Contract |
| --- | --- |
| `q` | Optional 1-120 character name/vintage search |
| `sort` | `created`, `updated` or `name`; default `updated` |
| `direction` | `asc` or `desc`; default `desc` |
| `limit` | Shared pagination limit |
| `cursor` | Shared opaque cursor |

Only active manual wines are returned.

Response: `200` list envelope containing manual-wine objects with their latest
assessment and derived freshness.

Errors:

- `400 INVALID_REQUEST`, `VALIDATION_FAILED` or `INVALID_CURSOR`;
- common authentication and server errors.

### `POST /v1/manual-wines`

Request:

```json
{
  "name": "Cellar Example",
  "vintage": "NV",
  "description": "Rich red fruit with soft tannins."
}
```

Response: `201` with the new active manual wine as `data`. Creation does not
enqueue an assessment; the client uses `POST /v1/assessment-requests` with the
returned `sourceKey`.

Errors:

- `400 VALIDATION_FAILED` for invalid name, vintage or description;
- `409 MANUAL_WINE_ALREADY_EXISTS` when normalised name plus vintage already
  exists for the user, including a soft-deleted record;
- common authentication and server errors.

### `GET /v1/manual-wines/{manualWineId}`

Request: manual-wine UUID; no body or query.

Response: `200` with the active manual wine as `data`.

Errors:

- `400 INVALID_REQUEST` for an invalid UUID;
- `404 MANUAL_WINE_NOT_FOUND` when it is absent or belongs to another user;
- `410 MANUAL_WINE_DELETED` when the user's record is soft-deleted;
- common authentication and server errors.

### `PATCH /v1/manual-wines/{manualWineId}`

Request:

```json
{
  "description": "Updated description."
}
```

`description` is the only accepted field. Name and vintage cannot be changed.
The update recalculates the manual source hash, updates `updatedAt`, and does
not automatically request an assessment.

Response: `200` with the updated manual wine and recalculated freshness.

Errors:

- `400 INVALID_REQUEST` when `name`, `vintage` or any unknown field is present;
- `400 VALIDATION_FAILED` for an invalid description;
- `404 MANUAL_WINE_NOT_FOUND` when absent or owned by another user;
- `410 MANUAL_WINE_DELETED` when already deleted;
- common authentication and server errors.

### `DELETE /v1/manual-wines/{manualWineId}`

Request: manual-wine UUID; no body or query.

Response: `200` with:

```json
{
  "data": {
    "id": "ffbd54ef-0c8e-49c7-a98e-e6703c08410e",
    "sourceKey": "manual:ffbd54ef-0c8e-49c7-a98e-e6703c08410e",
    "status": "deleted",
    "deletedAt": "2026-07-23T11:00:00.000Z"
  },
  "meta": {
    "requestId": "api-gateway-request-id"
  }
}
```

The operation is idempotent for the owning user: deleting an already deleted
wine returns the same `200` representation without changing `deletedAt`.

Errors:

- `400 INVALID_REQUEST` for an invalid UUID;
- `404 MANUAL_WINE_NOT_FOUND` when absent or owned by another user;
- common authentication and server errors.

## Frontend assessment-request state and polling

There is no durable assessment-request status API in the first release.
`requestId` and the allocated `assessmentVersion` correlate transient frontend
state with a specific queue message and eventual immutable result; they do not
imply a request-status DynamoDB record.

For each accepted request, the frontend:

1. stores `{sourceKey, requestId, assessmentVersion}` in in-memory application
   state and shows `queued`;
2. polls the exact assessment-version route after 2 seconds;
3. after the first `404 ASSESSMENT_NOT_FOUND`, may label the local state
   `processing`, but must not imply the server confirmed that state;
4. polls every 2 seconds until the exact version returns `200`;
5. stops after 30 attempts, 60 seconds after the first poll, and shows
   `timed_out` with copy explaining that processing may still complete;
6. refreshes the affected catalogue, assessed-wine or manual-wine query after
   completion so freshness is derived from current data.

Polling error behavior:

- `404 ASSESSMENT_NOT_FOUND` means not completed yet and continues polling;
- network errors, `429` and `5xx` retry with exponential backoff capped at 10
  seconds, but never beyond the 60-second overall timeout;
- `401` stops polling and starts the normal reauthentication flow;
- other `4xx` responses stop polling and show the safe API error;
- timeout does not cancel the queue message and does not allocate another
  version automatically.

A browser reload discards queued, processing, error and timeout presentation
state. After reload, the UI shows only durably completed assessments. The user
may explicitly request another assessment, which allocates another version.

## Home dashboard composition

The initial Home dashboard composes existing contracts rather than adding an
activity store or dashboard API:

- `GET /v1/palate-profile` provides the current profile and its `updatedAt`;
- `GET /v1/catalogue/wines?sort=first_seen&direction=desc` provides recently
  added current listings through durable `firstSeenAt`;
- `GET /v1/assessed-wines?sort=last_assessed&direction=desc` provides recently
  completed assessments.

The first release shows only activity derivable from durable domain records. It
does not infer events from frontend state or introduce a generic
activity-event table.

## Repository-local prototype

The approved visual handoff is
`src/ui/grapescrape_prototype.zip`. The CM-33/CM-34 ticket text abbreviates this
as `ui/grapescrape_prototype.zip`; `src/ui` is the repository's actual UI
workspace and is the canonical repository path.

The archive:

- may provide the frontend starting point;
- informs layout, visual tokens, reusable interaction patterns and copy;
- is overridden by the schemas, enum labels, routes and behavior in this
  document when fixtures or simulator labels differ;
- must not contribute generated simulator state to production domain logic;
- is reference/source material, not a deployed runtime dependency.

Future frontend planning must inspect the archive, but must not delete or
replace it casually.

## Change control

This ticket changes documentation and commits the approved prototype archive
only. It does not add application code, CDK resources, deployments, migrations,
production data writes, queue messages or OpenAI calls.

Later implementations must preserve the current deterministic assessment-key
and `AssessmentRequested` message contracts. If an established contract here
is insufficient, the implementing ticket must propose and review the smallest
documented contract change before code and infrastructure diverge.

---
description: "The Tencent Yuanbao Search-backed search provider for ctx.web: direct Search API retrieval with portable excerpts, dates, and per-search credential resolution."
kind: "package-reference"
---

# dsh-web-search-yuanbao

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-yuanbao`, the harness searches the web through Tencent Yuanbao Search and gets titles, URLs, excerpts, and publication dates from one direct API request. Choose it when a deployment holds a Tencent Cloud WSA API key and wants Yuanbao's search index without an auxiliary model turn. The provider maps `passage` (or a vertical result's `content`) to `snippet`, normalizes the service's date format to ISO-8601, and drops entries without a URL or excerpt. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Development](#development)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `yuanbao` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: yuanbao`.

### Install into a profile

The package declares a `dsh.bundle` layer, so `dsh plugin` installs it and adds the provider row for you:

```sh
dsh plugin --profile demo add ./dsh-web-search-yuanbao
```

The layer inserts the provider beside the base `web` row. Select it by setting `searchProvider: yuanbao` on that row in the profile's own `cordis.patch.yml` (or leave it as the only usable search backend). Store the key through the credentials service, or export `TENCENTCLOUD_WSA_APIKEY` in the launch environment.

### When to choose it

Choose this backend when a deployment has a Tencent Cloud Yuanbao Search API key and wants one direct retrieval request per query. Unlike `dsh-web-search-deepseek`, no model turn runs for a search, so latency and cost scale with the retrieval API alone. The provider is unavailable when the endpoint base does not parse; the configuration schema rejects any count other than 10, 20, 30, 40, or 50. A missing credential is reported when the search runs.

### Minimal configuration

Load the web service and the provider; the API key resolves through `ctx.credentials` when that service is mounted, otherwise from `$TENCENTCLOUD_WSA_APIKEY` in the launch environment.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: 'dsh-web-search-yuanbao'
  config:
    apiKeyEnv: TENCENTCLOUD_WSA_APIKEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal API key; prefer `apiKeyEnv` so no secret enters configuration |
| `apiKeyEnv` | `TENCENTCLOUD_WSA_APIKEY` | Credential reference resolved for each search; a non-empty literal `apiKey` wins |
| `baseURL` | `https://api.wsa.cloud.tencent.com` | Endpoint base; `/SearchPro` is appended. An unparseable value makes the provider unavailable |
| `count` | `10` | Results per search when the request carries no bound; one of 10, 20, 30, 40, 50. An unsupported value makes the provider unavailable |

The generated [configuration catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md#deepseek-aidsh-web-search-yuanbao) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each usable page maps to a `WebSearchSource`: `url`, `title` when present, `snippet` from `passage` (a vertical result falls back to `content`), and `publishedAt` normalized to ISO-8601. A vertical result prefers the URL, title, and date in its `display` envelope. An entry without a URL or excerpt is dropped; the service returns no generated answer, so `content` is omitted. A request's `maxResults` is rounded up to the smallest accepted `Cnt` — a bound of 8 sends 10 — and the web service enforces the final bound by truncating and flagging.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrongly structured bodies, and an error envelope — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`; a missing key surfaces as `WEB_PROVIDER_CREDENTIAL_MISSING`. HTTP redirects are rejected before the `Location` target is contacted. The provider does not retry or fall back to another backend. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="development"></a>
## Development

This project is a standalone extraction of the `web-search-yuanbao` package from the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) monorepo. It depends on the published `@deepseek-ai/dsh-*` packages at `0.2.1-rc.2`, so no monorepo checkout is required.

Requires Node `^22.19.0 || >=24.0.0` and pnpm.

```sh
pnpm install
pnpm build        # emit lib/ (JavaScript + declarations)
pnpm typecheck
pnpm test         # unit tests
pnpm test:e2e     # live API smoke; set TENCENTCLOUD_WSA_APIKEY first
```

The unit suite aliases the package name to `src/index.ts`, so `pnpm test` runs against source without a build. `pnpm test:e2e` self-skips when the key is absent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Yuanbao's Search API with three deliberate rules:

- **Direct retrieval only.** One request per search; no auxiliary model request, unlike the Messages-backed DeepSeek provider.
- **Portable excerpts only.** A source needs a real URL and excerpt; deriving one from other fields would make the seam lie, so unusable entries are dropped.
- **Per-search credentials.** The stored key is read for each operation, so a stored or rotated key reaches the next search without a restart.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, credential and environment resolution, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `YuanbaoSearchProvider`: request dispatch, response decoding, result mapping, abort classification |
| [`src/types.ts`](src/types.ts) | Yuanbao wire types: `YuanbaoSearchResponse`, `YuanbaoPage`, `YuanbaoError` |

### Request and mapping flow

`search()` reads one settings snapshot, resolves the credential, and posts `{ Query, Cnt }` to `{baseURL}/SearchPro` with `redirect: 'error'`, so a redirect fails without contacting the target. Each `Response.Pages` entry is decoded from its JSON string; usable pages are mapped in order and unusable ones dropped. An error envelope becomes `WEB_PROVIDER_ERROR`, as does any body the provider cannot interpret. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/README.md) — the package family and each role.
- [dsh-web](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web/README.md) — the web service this provider registers into.
- [dsh-tool-web](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md#deepseek-aidsh-web-search-yuanbao) — every accepted config field and its source declaration.
- [Web capability seam decision](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, excerpts, and ISO-8601 dates or its exact `Yuanbao search aborted`, `Yuanbao search request failed: <error>`, `Yuanbao search credential resolution failed: <error>`, `Yuanbao returned an invalid response body`, `Yuanbao search has no API key for "<ref>"`, and provider error-envelope messages under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **Only the query and result count reach the service** — the seam request has no site, mode, industry, or freshness field, so the skill's other controls wait on provider-neutral service fields.
- **An entry without a URL or excerpt is dropped entirely** — fewer sources than requested can return.
- **Dynamic credential availability resolves inside the operation** — the synchronous availability check cannot query the credential store, so a selected keyless provider fails the search with `WEB_PROVIDER_CREDENTIAL_MISSING`.
- **An unrecognized date is omitted** — `publishedAt` must be ISO-8601, so a provider value that neither matches ISO nor `YYYY/MM/DD HH:mm:ss` is dropped rather than passed through.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

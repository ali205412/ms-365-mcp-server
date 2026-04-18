# GAP Analysis: ms-365-mcp-server vs Official Microsoft Graph TypeScript SDK

**Audit date:** 2026-04-18
**Source SDK:** `/tmp/msgraph-sdk-typescript` @ preview.81 (2026-04-17), Lerna monorepo, Kiota-generated.
**Local code under review:** `/home/yui/Documents/ms-365-mcp-server/src/` (commit 888786f).

---

## Executive Summary

The official Microsoft Graph TypeScript SDK is a **thin facade** over Kiota's runtime: every workload package (`msgraph-sdk-chats`, `msgraph-sdk-users`, etc.) is purely generated *request builders* + *metadata*; all production-hardening behaviour (auth, retry, throttling, batching, parsing, observability, redirects, large-file uploads, change-tracking iteration) lives in the externally-published `@microsoft/kiota-*` and `@microsoft/msgraph-sdk-core` packages that the SDK depends on. The TypeScript repo we cloned (144 MB) is essentially a giant tree of metadata records like `RequestsMetadata = { get: { uriTemplate, errorMappings: { XXX: createODataErrorFromDiscriminatorValue }, adapterMethodName: "send", responseBodyFactory, queryParametersMapper } }` — it never implements `fetch`, retries, or pagination itself.

ms-365-mcp-server takes the opposite shape: a **single, hand-rolled HTTP layer** (`src/graph-client.ts`, ~360 LOC) wrapped around `fetch`, with `openapi-zod-client` generating Zodios endpoint records and `src/generated/hack.ts` mutating parameter names because MCP clients reject `$`-prefixed names. There is no retry policy, no 429/`Retry-After` honouring, no `$batch` helper, no resumable-upload state machine, no delta/subscription helpers, no typed error envelope, and no ETag conditional-request plumbing.

For multi-tenant production use, the gap is wide and concentrated in **transport/middleware behaviour**. The codegen choice (Kiota vs openapi-zod-client) is largely orthogonal: openapi-zod-client serves the MCP use case better (Zod schemas → JSON Schema → MCP tool params is one transform; Kiota's fluent `client.users.byId().messages.get()` is wrong shape for an MCP server). The right path is **keep the generator and bolt on a Kiota-style middleware pipeline** in `graph-client.ts`. None of the high-priority gaps require swapping the generator.

Top 3 immediate risks under multi-tenant load:
1. No 429 handling — first burst of concurrent users will cascade-fail.
2. Hand-rolled MSAL `getTokenForAccount` selects accounts from a process-local cache — does not scale horizontally and conflates "logged-in user" with "tenant".
3. Pagination silently truncates at 10 000 items with no flag in the response — auditable export use cases will return wrong data.

---

## Dimension-by-Dimension Comparison

### Quick reference table

| # | Dimension | SDK approach (where) | Our approach (where) | Gap | Recommendation |
|---|---|---|---|---|---|
| 1 | Auth / token providers | `AuthenticationProvider` interface from `@microsoft/kiota-abstractions`; ships `AzureIdentityAuthenticationProvider` over `@azure/identity` credentials (`AuthorizationCodeCredential`, `ClientSecretCredential`, `ClientCertificateCredential`, `OnBehalfOfCredential`, `DeviceCodeCredential`, `InteractiveBrowserCredential`, `UsernamePasswordCredential`) — README §2.2.1–2.2.6 | Single `PublicClientApplication` (MSAL Node) with hand-rolled multi-account selection (`src/auth.ts:719-773 getTokenForAccount`); custom `MS365_MCP_OAUTH_TOKEN` envelope; HTTP mode reads bearer from `x-microsoft-refresh-token` custom header (`src/lib/microsoft-auth.ts:27`) | No abstraction — only the public-client device/interactive flows. No client-credentials (app-only), no certificate, no on-behalf-of, no managed-identity. Multi-tenant means swapping `tenantId` on the singleton MSAL app — which doesn't work because authority is set at construction time | Define an `AuthenticationProvider` interface; ship implementations for Public/Confidential/OBO/MI; instantiate per-tenant on demand |
| 2 | Pagination | Iterator pattern documented at <https://learn.microsoft.com/graph/sdks/paging>; `PageIterator` lives in `@microsoft/msgraph-sdk-core`. Per-endpoint *delta* request builders generated (e.g. `chats/item/messages/delta/index.ts:29 DeltaRequestBuilder`) yielding `@odata.nextLink` and `@odata.deltaLink` | Manual `while (nextLink && pageCount < 100 && allItems.length < 10_000)` loop in `src/graph-tools.ts:400-449`. Truncates silently; deletes `@odata.nextLink` from the merged response (`src/graph-tools.ts:439`) | No async iterator, no caller-side flow control, no resumability via `@odata.nextLink` round-trip, hard cap with no `_truncated` flag | Replace with async generator; surface `nextLink` in response when truncated; let callers pass `maxPages` per-request |
| 3 | Throttling / 429 | Handled by `@microsoft/kiota-http-fetchlibrary` middleware chain (RetryHandler, RedirectHandler, RetryHandlerOptions exposed via `ObservabilityOptions` in `graphRequestAdapter.ts:31`) | **None.** `src/graph-client.ts:208-229 performRequest` calls `fetch(url, ...)` once; on 401 retries with refreshed token (`graph-client.ts:101-108`); 429 falls through to "Microsoft Graph API error: 429 ..." thrown to caller (`graph-client.ts:122-126`) | Critical. No `Retry-After` parsing, no exponential backoff, no jitter, no per-tenant circuit breaker | Implement middleware chain: parse `Retry-After` (seconds or HTTP-date), exponential backoff with full jitter, max retries, surface throttle metrics |
| 4 | Batch requests | Documented Graph `$batch` endpoint with up to 20 sub-requests, dependency chains via `dependsOn`. Helper in `@microsoft/msgraph-sdk-core` (npm: `BatchRequestContent`/`BatchResponseContent`) | **None.** Each tool invocation = one HTTP request. No way to coalesce sibling reads inside `fetchAllPages`, no way to atomically apply a multi-step mutation | High. MCP tool calls regularly arrive in clusters (e.g., "get inbox + get calendar + get tasks" in one user turn) | Add a thin `BatchClient` that buffers requests within a tick and flushes via `POST /$batch`; expose explicit `batch()` helper for advanced callers |
| 5 | OData query helpers | Per-builder strongly-typed query parameters: `MessagesRequestBuilderGetQueryParameters` (`chats/item/messages/index.ts:75-108`) with typed `select?: string[]`, `expand?: string[]`, `filter?: string`, `orderby?: string[]`, `top?: number`, `skip?: number`, `count?: boolean`, `search?: string`. Property-name mapper `MessagesRequestBuilderGetQueryParametersMapper` (lines 116-125) handles `select` → `%24select`. URI template at line 112 uses RFC 6570 syntax | Treated as raw strings in `src/graph-tools.ts:574-630`. The `$` prefix is stripped in `hack.ts:18` then re-injected at call time (`graph-tools.ts:174-202`). `$select` arrives as comma-joined string from the LLM, no array-typing | Medium. Works, but loses type safety, allows malformed values (e.g., `$select=foo bar` with a space), and the round-trip strip-then-restore is the source of half the bugs in `executeGraphTool` | Pre-validate OData strings (parse + serialize) per dimension; expose typed helpers for `$select`/`$expand` taking `string[]`; the URL encoding becomes deterministic |
| 6 | ETag conditional requests | Pass `If-Match` / `If-None-Match` via `RequestConfiguration.headers` parameter (per builder `RequestConfiguration<...QueryParameters>`) — no special API, just headers | `src/graph-client.ts:161-170` extracts `ETag` from response when `includeHeaders=true`, attaches as `_etag` to the result. **No `If-Match` propagation** — the LLM has no way to send a conditional update, even though half the destructive operations should require it (calendar event updates, contact PATCH, drive item PATCH all need optimistic concurrency in shared tenants) | High. Concurrent edits to a calendar event in a multi-user tenant will silently last-writer-wins | Add `ifMatch` / `ifNoneMatch` control parameters; auto-include for PATCH/DELETE on resources with known ETag fields (drive items, calendar events, mail messages) |
| 7 | Change notifications / subscriptions / delta | Generated request builders for `/subscriptions` POST/GET/DELETE (`msgraph-sdk-subscriptions/subscriptions/index.ts`); per-resource `delta()` builders that round-trip `@odata.deltaLink` (`chats/item/messages/delta/index.ts:31` documents the contract: copy `@odata.nextLink` until empty, then store `@odata.deltaLink` for next round) | Subscriptions are exposed as raw endpoints in `endpoints.json` if present, but no helper. `delta` endpoints are likewise just HTTP — no helper to persist the delta token. **No webhook receiver** in this server (it has no `/notifications` route in `src/server.ts`) | Critical for change-driven workflows. Without delta tokens, every "give me new mail since last check" is a full sweep. Without a webhook receiver, push-based updates from Microsoft are impossible | Add a `delta` helper that persists tokens per (tenant, resource); add a `/notifications` express route with the validation-token handshake for subscription registration |
| 8 | Error normalization | `ODataError` model (`models/oDataErrors/index.ts:166-175`) with `errorEscaped: MainError` containing `code`, `message`, `details: ErrorDetails[]`, `innerError` (with `clientRequestId`, `requestId`, `date`). Every endpoint metadata pins `errorMappings: { XXX: createODataErrorFromDiscriminatorValue }` (`chats/item/messages/index.ts:152-153`) so the runtime auto-deserialises 4xx/5xx bodies into typed `ODataError` exceptions | `src/graph-client.ts:122-126` `throw new Error('Microsoft Graph API error: 403 Forbidden - <body-text>')` — body is **string-concatenated** into the message; no parsing of the `error.code`, `error.innerError.requestId`, etc. The 403 branch (`graph-client.ts:110-119`) does string-search for "scope"/"permission" but does not extract the structured fields | High. Operators have no `request-id` to correlate with Graph telemetry. LLMs see opaque text instead of typed `code: "ResourceNotFound"` etc. | Define `GraphError` class; parse `{error: {code, message, innerError: {requestId, clientRequestId, date}}}`; preserve original status; surface `requestId` in MCP `_meta` |
| 9 | Resumable large file uploads | Only the *createUploadSession* request builder is generated (`drives/item/items/item/createUploadSession/index.ts:33 CreateUploadSessionRequestBuilder`); the actual chunked-upload **state machine** lives in `@microsoft/msgraph-sdk-core` as `LargeFileUploadTask` (per Microsoft Learn docs). It chunks at 320 KiB multiples, retries on 5xx, and resumes from `nextExpectedRanges` after a failure | None. Upload tools in `endpoints.json` (`upload-large-attachment` etc.) post the entire body in one PUT. Express body-parser default limit (100 KB, `src/server.ts:179`) means anything >100 KB silently truncates in HTTP mode (already noted in CONCERNS.md) | Critical for Drive/OneDrive use cases (>4 MB single PUT limit; SharePoint hard cap 250 MB direct, 250 GB via session) | Implement an `UploadSession` helper: createSession → chunk to 320 KiB × N → PUT each with `Content-Range` → on 5xx, GET session URL for `nextExpectedRanges`, resume |
| 10 | Retry policy for transient 5xx | Same Kiota `RetryHandler` middleware as 429; defaults to retry on 503/504/429 with exponential backoff, max 3 attempts; configurable via `RetryHandlerOptions` | None for 5xx. The `if (!response.ok)` at `src/graph-client.ts:122` throws on the first attempt | High. Multi-tenant Graph emits 503 during AAD service blips; one transient hit poisons the entire tool call | Combine with #3 — single retry handler covering 408/429/500-504 with backoff |
| 11 | Generator strategy | **Kiota** generates request-builder fluent API + per-endpoint `RequestsMetadata` records consumed by a runtime proxifier (`apiClientProxifier` in `graphServiceClient.ts:22`). Models, serializers, deserializers, error mappings are all emitted per workload package (~60 packages). Output is a **fluent navigable API** (`graphServiceClient.users.byUserId('...').messages.byChatMessageId('...').get()`). Per-endpoint URI templates use RFC 6570 (`{+baseurl}/chats/{chat%2Did}/messages{?%24count,...}`, `chats/item/messages/index.ts:112`) which encodes parameter names with the literal `%24` so callers never deal with `$` directly | **openapi-zod-client** generates `src/generated/client.ts` (gitignored) into a single Zodios `api` array. We then post-process via `bin/modules/simplified-openapi.mjs` (23 KB, trims the OpenAPI), `remove-recursive-refs.js` (works around openapi-zod-client #36/#62 recursive-ref bugs), and `src/generated/hack.ts` (replaces real `Zodios` with a hand-rolled shim that mutates parameter names to strip `$`/`_`). The output is a **flat array of endpoint records** consumed by `registerGraphTools` to register each as an MCP tool | Trade-off discussed below. Short version: Kiota is the wrong shape for an MCP server (you need a flat list of tool descriptors, not a fluent client), but openapi-zod-client + hack.ts is fragile (3 separate post-processing steps, all silently coupled to upstream OpenAPI shape and openapi-zod-client output format) | Keep openapi-zod-client; document the `hack.ts` ↔ `executeGraphTool` parameter-name contract explicitly; long-term, evaluate generating directly from the Graph OpenAPI spec into a custom IR for MCP |

### Prose detail per dimension

**1. Authentication.** The SDK's `AuthenticationProvider` interface (from `@microsoft/kiota-abstractions`, attached to `GraphRequestAdapter` constructor at `graphRequestAdapter.ts:27`) is a single method: `authenticateRequest(request, additionalContext)`. The `AzureIdentityAuthenticationProvider` (in `@microsoft/kiota-authentication-azure` per README §2.2) wraps any `@azure/identity` `TokenCredential`, so users plug in any of seven credential flows uniformly. Our `src/auth.ts` builds *one* `PublicClientApplication` keyed to a single `tenantId` from secrets (`auth.ts:124`) and bolts on multi-account selection (`auth.ts:719-773`). Multi-tenant means re-instantiating MSAL with a new authority — there is no abstraction for that today.

**2. Pagination.** The SDK does not ship a one-line iterator in this repo; the `PageIterator` is in `@microsoft/msgraph-sdk-core`. Its public contract is documented (Microsoft Learn /graph/sdks/paging): callers iterate with `for await`. Our `fetchAllPages` (`graph-tools.ts:400-449`) bakes the iteration *inside* the tool call — the LLM cannot interleave another tool call between pages, cannot cancel mid-stream, cannot resume. The 100-page / 10 000-item caps are *opaque* to the caller (CONCERNS.md known bug).

**3. Throttling.** The SDK delegates to `@microsoft/kiota-http-fetchlibrary` which composes a middleware chain (RetryHandler → RedirectHandler → ParametersNameDecodingHandler → UserAgentHandler → HeadersInspectionHandler → TelemetryHandler). Each can be overridden via `requestConfiguration.options`. We have **none** of this. A single 429 fails the entire user request.

**4. Batch.** The SDK's batch helper is in `@microsoft/msgraph-sdk-core` (`BatchRequestContent`, `BatchResponseContent`). It composes up to 20 sub-requests with optional `dependsOn` chains, posts to `POST /$batch`, parses the JSON envelope of responses. Useful for "list inbox + count unread + list calendar" in one round-trip. We have nothing.

**5. OData query helpers.** Each generated builder declares a typed `*GetQueryParameters` interface (e.g., `MessagesRequestBuilderGetQueryParameters` at `chats/item/messages/index.ts:75-108`) and a string-keyed mapper to URL-encode the `$` prefix (`MessagesRequestBuilderGetQueryParametersMapper` at line 116). The URI template (line 112) is RFC 6570: `{+baseurl}/chats/{chat%2Did}/messages{?%24count,%24expand,%24filter,%24orderby,%24search,%24select,%24skip,%24top}`. Notice `%24` (URL-encoded `$`) and `%2D` (URL-encoded `-`) are baked into the template — Kiota expands the template once; no name munging. Our approach strips the `$`, then bolts it back on (`graph-tools.ts:185-188`). The kebab-case path parameter handling (`{message-id}` vs `:messageId`) requires three explicit `path.replace` calls per branch (`graph-tools.ts:218-222`, duplicated at 271-274).

**6. ETag.** Standard HTTP — the SDK doesn't have a special API; you set `requestConfiguration.headers["If-Match"] = etag`. We extract ETag in responses but never send `If-Match`. Concurrency-safe updates in a multi-tenant deployment require this; without it, last-writer-wins on every PATCH.

**7. Change notifications, subscriptions, delta.** The SDK exposes per-resource `DeltaRequestBuilder` (`chats/item/messages/delta/index.ts:29`) and the `/subscriptions` endpoint family (`msgraph-sdk-subscriptions/subscriptions/index.ts`). The doc comment on `delta` GET (line 31) explicitly describes the deltaLink lifecycle: "copy and apply the @odata.nextLink or @odata.deltaLink URL returned from the last GET request". Our server has neither a delta-token store nor a `/notifications` webhook receiver. For an MCP server that wants "show me what's new in the user's mailbox", this means polling everything every time.

**8. Error normalization.** The Graph error envelope is well-typed in the SDK: `ODataError` with `errorEscaped.code`, `errorEscaped.message`, `errorEscaped.details[]`, `errorEscaped.innerError.requestId`, `errorEscaped.innerError.clientRequestId`, `errorEscaped.innerError.date` (`models/oDataErrors/index.ts:100-175`). Every endpoint pins `errorMappings: { XXX: createODataErrorFromDiscriminatorValue }` (e.g., `chats/item/messages/index.ts:152-153`). We string-concatenate the body into an `Error.message` (`graph-client.ts:122-126`). The `requestId` from Graph — needed to file support tickets and to correlate with AAD telemetry — is discarded.

**9. Resumable uploads.** Only the *create-session* endpoint is generated. The state machine (chunked PUT with `Content-Range`, resume on `nextExpectedRanges`) is in `@microsoft/msgraph-sdk-core` as `LargeFileUploadTask`. We do neither. The express body-parser default limit (100 KB at `src/server.ts:179`) compounds the problem in HTTP mode.

**10. Transient 5xx retry.** Same Kiota `RetryHandler` as 429 — defaults to retry on 408/429/500/502/503/504 with backoff. We don't retry. Combined with #3, this is one fix.

**11. Generator strategy — trade-off.** Kiota produces a *fluent* API (`client.users.byUserId('jane@contoso.com').messages.get()`). That shape is excellent for hand-written application code but **the wrong shape for an MCP server**: MCP needs a *flat array of tool descriptors* with JSON Schema parameter shapes that the LLM can browse. Wrapping Kiota would mean either (a) walking the metadata tree at startup to extract the flat tool list — feasible but awkward because Kiota's metadata format is internal — or (b) using Kiota only as a runtime executor, which discards 90 % of its value (the typed builders). openapi-zod-client gives us Zod schemas that map directly to MCP tool params and JSON Schema with one transform. The pain points (`hack.ts`, kebab-case path handling, `$` munging) are solvable inside the existing pipeline — they don't require switching generators.

---

## Top 10 Gaps Ranked by Priority + Effort

| Rank | Gap | Priority | Effort | Why |
|---|---|---|---|---|
| 1 | **No 429 / Retry-After / backoff** for any Graph call | CRITICAL | M (2-3 d) | First multi-user burst cascades to errors. Cannot be deployed multi-tenant without it. Single PR in `graph-client.ts:performRequest`. |
| 2 | **No `$batch` endpoint** support | HIGH | M (3-5 d) | MCP tool clusters (3-5 reads per user turn) currently issue 3-5 round trips. Batch trims to one. New `BatchClient` class + queue/flush logic. |
| 3 | **No resumable large-file uploads** (UploadSession state machine) | HIGH | L (5-8 d) | Drive/OneDrive uploads >4 MB silently fail. SharePoint cap drops from 250 GB to single-PUT limit. Need chunked PUT + resume from `nextExpectedRanges`. |
| 4 | **No transient 5xx retry** (independent of 429) | CRITICAL | S (1 d) | One PR alongside #1 — same middleware. AAD service blips currently fail tools instead of recovering. |
| 5 | **Pagination silent truncation at 10k items**; no async iterator | HIGH | S (1-2 d) | Audit/export workflows return wrong counts with no warning. Add `_truncated` flag, surface `nextLink`, allow per-call `maxPages` override. |
| 6 | **No typed Graph error envelope** — `requestId` discarded | HIGH | S (1-2 d) | Operators cannot correlate failures with Graph/AAD telemetry. Parse `{error: {code, message, innerError: {requestId, clientRequestId}}}` and surface in `_meta`. |
| 7 | **No multi-tenant authority abstraction** — single MSAL singleton hard-bound to one tenant | CRITICAL | L (5-10 d) | Cannot serve more than one tenant from one process. Need tenant-keyed MSAL pool (or `AuthenticationProvider` interface like SDK) and a token-cache index that does not collide across tenants. |
| 8 | **No delta query helper** + **no `/notifications` webhook receiver** | MED | L (5-10 d) | Forces full sweeps for "what changed since last poll". Webhook receiver requires Express route + HMAC validation + handshake. |
| 9 | **No ETag `If-Match` on PATCH/DELETE** | HIGH | S (1-2 d) | Last-writer-wins on every shared-resource update. Add control params; auto-attach when caller supplies an ETag from a prior response. |
| 10 | **`hack.ts` parameter-name munging fragility** + duplicated path-replace logic | MED | M (3-5 d) | Source of half the bugs in `executeGraphTool`. Document the contract or refactor to a single `paramTransformer` module with unit tests covering kebab/camel/`$`-prefix interactions. |

**Cumulative effort:** 26-49 person-days for the full top-10. The 4-item "deploy-blocker bundle" (#1, #4, #7, plus #5 to avoid silent data loss) is **8-15 person-days** and unblocks multi-tenant production.

---

## Architectural Recommendation

**Keep openapi-zod-client + bolt on SDK-style middleware + helpers.** Do not wrap the official SDK directly.

### Why not wrap the SDK
1. **Wrong shape.** Kiota's fluent builders (`client.users.byUserId('...').messages.get()`) have to be flattened into an MCP tool list. The metadata records (`MessagesRequestBuilderRequestsMetadata` etc.) are internal and not exposed as a public iteration API. Walking them at startup to emit MCP tools is a custom integration that adds complexity for no gain over the OpenAPI walk we already do.
2. **Loses control over Zod-to-MCP mapping.** The MCP layer needs JSON Schema parameter descriptors. Zod gives us this in one transform via `zod-to-json-schema`. Kiota emits TypeScript interfaces, not runtime schemas — we'd have to bolt Zod (or `ajv`) back on top.
3. **144 MB of generated code per workload.** Bringing in `@microsoft/msgraph-sdk-*` packages bloats install size for use cases where most tools are filter-disabled. Our `endpoints.json` workflow already lets us trim aggressively.
4. **The hard parts (auth, retry, batch, uploads) are in the *runtime* packages, not the workload SDKs.** Those runtime packages (`@microsoft/kiota-http-fetchlibrary`, `@microsoft/msgraph-sdk-core`) **can** be adopted independently. We can:
   - Use `@microsoft/kiota-http-fetchlibrary` middleware chain inside `graph-client.ts` (RetryHandler, RedirectHandler, TelemetryHandler).
   - Use `@microsoft/msgraph-sdk-core`'s `BatchRequestContent`, `LargeFileUploadTask`, `PageIterator` as standalone helpers.
   - Use `@microsoft/kiota-authentication-azure` + `@azure/identity` for the `AuthenticationProvider` interface so multi-tenant credential strategies plug in uniformly.

### Recommended path
1. **Phase 1 (transport hardening, ~10 d):** Add a Kiota-style middleware chain to `graph-client.ts`. Adopt `@microsoft/kiota-http-fetchlibrary` directly for RetryHandler (covers gaps #1, #4) — it already handles `Retry-After`, exponential backoff, jitter, and 408/429/5xx.
2. **Phase 2 (multi-tenant auth, ~10 d):** Define an `AuthenticationProvider` interface mirroring the SDK; ship `MsalPublicClientProvider` (current behaviour), `MsalConfidentialClientProvider` (client credentials), and `BearerTokenProvider` (HTTP/OAuth mode). Replace MSAL singleton with a tenant-keyed pool. This addresses gap #7.
3. **Phase 3 (helper bolt-ons, ~15 d):** Adopt `BatchRequestContent` + `LargeFileUploadTask` + `PageIterator` as standalone helpers (gaps #2, #3, #5). Each becomes a dedicated MCP tool family.
4. **Phase 4 (typed errors + ETag, ~5 d):** Parse `ODataError` envelope, surface `requestId` in `_meta`, propagate `If-Match`/`If-None-Match` (gaps #6, #9).
5. **Phase 5 (delta + subscriptions, ~10 d):** Delta-token store + `/notifications` webhook receiver (gap #8).
6. **Phase 6 (hack.ts cleanup, ~5 d):** Document or refactor (gap #10) — defer until after Phase 1-4 since it is internal hygiene with no user-visible behaviour change.

Total effort: ~55 person-days end-to-end; but the **deploy-blocker bundle (Phases 1+2 partial: just the bearer-provider abstraction)** is ~12 person-days and is the minimum bar for multi-tenant.

---

## Code Snippets from the SDK Worth Adopting

### Snippet 1 — `AuthenticationProvider` injection point (multi-credential support)

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk/graphRequestAdapter.ts:17-43`

```ts
export class GraphRequestAdapter extends BaseGraphRequestAdapter {
  constructor(
    authenticationProvider: AuthenticationProvider,           // ← any TokenCredential
    parseNodeFactory: ParseNodeFactory = new ParseNodeFactoryRegistry(),
    serializationWriterFactory: SerializationWriterFactory = new SerializationWriterFactoryRegistry(),
    httpClient?: HttpClient,                                  // ← inject custom fetch / middleware chain
    observabilityOptions: ObservabilityOptions = new ObservabilityOptionsImpl(),
  ) {
    super("", version, authenticationProvider, parseNodeFactory,
          serializationWriterFactory, httpClient, observabilityOptions);
  }
}
```

The pattern: a single interface (`AuthenticationProvider`) with one method (`authenticateRequest`); concrete implementations for each credential flow live in separate packages. Lift this into `src/auth.ts` and convert `getToken` callers to use it.

### Snippet 2 — Typed OData query parameters per endpoint

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-chats/chats/item/messages/index.ts:75-125`

```ts
export interface MessagesRequestBuilderGetQueryParameters {
    count?: boolean;
    expand?: string[];          // ← typed array, not joined string
    filter?: string;
    orderby?: string[];
    search?: string;
    select?: string[];
    skip?: number;
    top?: number;
}
const MessagesRequestBuilderGetQueryParametersMapper: Record<string, string> = {
    "count":   "%24count",
    "expand":  "%24expand",
    "filter":  "%24filter",
    "orderby": "%24orderby",
    "search":  "%24search",
    "select":  "%24select",
    "skip":    "%24skip",
    "top":     "%24top",
};
```

Compared to our current "strip `$`, restore at call time" round-trip in `src/graph-tools.ts:185-188`: a single mapper table keyed by symbolic name maps to the URL-encoded form. No mutation of the parameter name in `hack.ts` would be needed — Zod input keys stay symbolic; the mapper handles the URL encoding once.

### Snippet 3 — RFC 6570 URI template with literal URL-encoded segments

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-chats/chats/item/messages/index.ts:112`

```ts
export const MessagesRequestBuilderUriTemplate =
  "{+baseurl}/chats/{chat%2Did}/messages{?%24count,%24expand,%24filter,%24orderby,%24search,%24select,%24skip,%24top}";
```

`{chat%2Did}` is the literal URL-encoded `chat-id` placeholder. Templates are expanded once with a `uri-template-lite`-style function. Compare to our `src/graph-tools.ts:218-222`:

```ts
path = path
  .replace(`{${paramName}}`, encodedValue)
  .replace(`:${paramName}`, encodedValue)
  .replace(`{${camelCaseParamName}}`, encodedValue)
  .replace(`:${camelCaseParamName}`, encodedValue);
```

Four `.replace` calls because we accept three name forms. RFC 6570 expansion would be one call with deterministic encoding.

### Snippet 4 — Per-endpoint `RequestsMetadata` with typed error mapping

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-chats/chats/item/messages/index.ts:148-171`

```ts
export const MessagesRequestBuilderRequestsMetadata: RequestsMetadata = {
    get: {
        uriTemplate: MessagesRequestBuilderUriTemplate,
        responseBodyContentType: "application/json",
        errorMappings: {
            XXX: createODataErrorFromDiscriminatorValue as ParsableFactory<Parsable>,
        },
        adapterMethodName: "send",
        responseBodyFactory:  createChatMessageCollectionResponseFromDiscriminatorValue,
        queryParametersMapper: MessagesRequestBuilderGetQueryParametersMapper,
    },
    post: {
        uriTemplate: MessagesRequestBuilderUriTemplate,
        responseBodyContentType: "application/json",
        errorMappings: { XXX: createODataErrorFromDiscriminatorValue as ParsableFactory<Parsable> },
        adapterMethodName: "send",
        responseBodyFactory: createChatMessageFromDiscriminatorValue,
        requestBodyContentType: "application/json",
        requestBodySerializer: serializeChatMessage,
        requestInformationContentSetMethod: "setContentFromParsable",
    },
};
```

Every endpoint pins an `errorMappings.XXX` (the wildcard for any 4xx/5xx) to `createODataErrorFromDiscriminatorValue`. The runtime adapter auto-deserialises non-2xx responses into typed `ODataError` exceptions before they reach user code. Adopt the same pattern in `graph-client.ts:122-126`: rather than a string-concat `Error`, throw a `GraphError` with parsed `code`/`message`/`requestId`.

### Snippet 5 — `ODataError` envelope shape

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk/models/oDataErrors/index.ts:100-175`

```ts
export interface InnerError extends AdditionalDataHolder, BackedModel, Parsable {
    backingStoreEnabled?: boolean | null;
    clientRequestId?: string | null;          // ← from "client-request-id" header
    date?: Date | null;
    odataType?: string | null;
    requestId?: string | null;                // ← Graph correlation id, file with support
}
export interface MainError extends AdditionalDataHolder, BackedModel, Parsable {
    code?: string | null;                     // ← e.g. "ResourceNotFound", "Throttled"
    details?: ErrorDetails[] | null;
    innerError?: InnerError | null;
    message?: string | null;
    target?: string | null;
}
export interface ODataError extends AdditionalDataHolder, ApiError, BackedModel, Parsable {
    errorEscaped?: MainError | null;          // ← named "errorEscaped" because TS reserves "error"
}
```

Our `GraphError` should expose at minimum: `status: number`, `code: string`, `message: string`, `requestId: string`, `clientRequestId: string`, `date: Date | null`, `details: Array<{code, message, target}>`. Surface `requestId` in MCP `_meta` so operators can paste it into Microsoft support tickets.

### Snippet 6 — Delta endpoint contract

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-chats/chats/item/messages/delta/index.ts:31`

```
Get the list of messages from all chats in which a user is a participant ...
A GET request with the delta function returns one of the following:
  State tokens are opaque to the client. To proceed with a round of change tracking,
  copy and apply the @odata.nextLink or @odata.deltaLink URL returned from the last
  GET request to the next delta function call.
  An @odata.deltaLink returned in a response signifies that the current round of
  change tracking is complete.
```

Implementation pattern: persist `(tenantId, resourceUrl) -> deltaLink` in a small store. On next call, GET the deltaLink. If response has `@odata.nextLink`, follow it (intermediate). If response has `@odata.deltaLink`, replace stored token. Without this, every "what's new" question is a full enumeration.

### Snippet 7 — Subscription model (webhook target)

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-subscriptions/subscriptions/index.ts:32-39`

```
Subscribes a listener application to receive change notifications when the
requested type of changes occur to the specified resource in Microsoft Graph...
Some resources support rich notifications, that is, notifications that include
resource data.
```

Implementation: POST `/subscriptions` with `{ changeType, notificationUrl, resource, expirationDateTime, clientState }`. Receive POST to your `notificationUrl` with `validationToken` query string on first call (must echo back within 10 s, plain text, 200 OK). Add a `/notifications` route to `src/server.ts` to handle both the validation handshake and the subsequent JSON payloads.

### Snippet 8 — `CreateUploadSessionPostRequestBody` (start of resumable upload)

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-drives/drives/item/items/item/createUploadSession/index.ts:20-29, 77`

```ts
export interface CreateUploadSessionPostRequestBody extends ... {
    backingStoreEnabled?: boolean | null;
    item?: DriveItemUploadableProperties | null;
}
export const CreateUploadSessionRequestBuilderUriTemplate =
  "{+baseurl}/drives/{drive%2Did}/items/{driveItem%2Did}/createUploadSession";
```

The session URL returned has `uploadUrl` (signed, no auth required) and `expirationDateTime`. State machine: chunk file at 320 KiB × N (max 60 MiB per chunk for Drive); for each chunk, `PUT <uploadUrl>` with `Content-Range: bytes start-end/total`. On 5xx or network failure, GET `<uploadUrl>` to read `nextExpectedRanges`, resume from there. On final successful PUT, response is `201 Created` with the DriveItem.

### Snippet 9 — Apply `If-Match` via request configuration headers

The SDK adds headers via the standard `RequestConfiguration<TQueryParams>.headers` field — no special API. Equivalent in our codebase would be:

```ts
// In executeGraphTool, when params.ifMatch is provided:
if (typeof params.ifMatch === 'string') {
  headers['If-Match'] = params.ifMatch;
}
if (typeof params.ifNoneMatch === 'string') {
  headers['If-None-Match'] = params.ifNoneMatch;
}
```

Plus: when a previous tool call returned `_etag` in `_meta`, surface that to the LLM with explicit guidance to pass it back on the next PATCH. The `_etag` round-trip is already half-implemented at `graph-client.ts:161-170`.

### Snippet 10 — Per-workload metadata composition for client extension

`/tmp/msgraph-sdk-typescript/packages/msgraph-sdk-users/usersServiceClient.ts:11-46`

```ts
export function createUsersServiceClient(requestAdapter: RequestAdapter) {
    if (requestAdapter.baseUrl === undefined || requestAdapter.baseUrl === "") {
        requestAdapter.baseUrl = "https://graph.microsoft.com/v1.0";
    }
    const pathParameters: Record<string, unknown> = {
        "baseurl": requestAdapter.baseUrl,
        "user%2Did": "TokenToReplace",
    };
    return apiClientProxifier<UsersServiceClient>(
      requestAdapter, pathParameters,
      UsersServiceClientNavigationMetadata, undefined);
}
```

Pattern: per-workload service client is a *proxified* navigable interface composed from per-endpoint metadata. The base URL is set lazily; multi-cloud (China, Gov) is handled by overriding `requestAdapter.baseUrl`. Compare to our `src/cloud-config.ts` — same idea, but we handle it inside `graph-client.ts:performRequest` (`graph-client.ts:213-214`) for every call. Centralising it on the adapter / client construction would be cleaner.

---

*End of report. Sources: `/tmp/msgraph-sdk-typescript/` (preview.81, 2026-04-17) and `/home/yui/Documents/ms-365-mcp-server/src/` (commit 888786f).*

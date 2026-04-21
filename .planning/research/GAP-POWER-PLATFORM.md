# Power Platform + M365 Admin Coverage Baseline

**Generated:** 2026-04-21 (plan 05.1-08 baseline commit)
**Purpose:** Per-product op-count baseline + coverage regression tolerance + churn policy summary across the five Phase 5.1 products.
**Consumed by:**
- `bin/modules/coverage-check.mjs` `PRODUCT_POLICIES` map — per-product regression thresholds at `verify:coverage` time.
- `bin/modules/run-product-pipeline.mjs` per-product churn guards — strict vs permissive enforcement at codegen time (via `MS365_MCP_ACCEPT_<PRODUCT>_CHURN` env vars).
- CI `npm run verify:coverage` step (see `.github/workflows/build.yml`).

This file is the regression anchor. Updates require a corresponding coverage-harness run; operators should NOT hand-edit op counts without regenerating against the upstream spec (or, for EXO / SP-Admin, updating the hand-authored fragment).

## Per-Product Baseline

| Product            | Workload prefix          | Alias prefix literal | Baseline op count | Codegen churn policy (D-04) | Coverage regression threshold | Strict env var                      |
| ------------------ | ------------------------ | -------------------- | ----------------- | --------------------------- | ---------------------------- | ----------------------------------- |
| Graph (v1 + beta)  | Mail / Calendars / ...   | (various + `__beta__`)| ~14000 (Phase 5 owns)           | N/A — owned by Phase 5   | -10% error / -5% warn         | `MS365_MCP_ACCEPT_BETA_CHURN`       |
| Power BI           | `powerbi`                | `__powerbi__`        | TBD (first-run measurement)     | Permissive               | -10% error / -5% warn         | `MS365_MCP_ACCEPT_POWERBI_CHURN`    |
| Power Apps         | `pwrapps`                | `__pwrapps__`        | 15-18 (hand-authored)           | Permissive               | -10% error / -5% warn         | `MS365_MCP_ACCEPT_PWRAPPS_CHURN`    |
| Power Automate     | `pwrauto`                | `__pwrauto__`        | 15-20 (hand-authored)           | Permissive               | -10% error / -5% warn         | `MS365_MCP_ACCEPT_PWRAUTO_CHURN`    |
| Exchange Admin     | `exo`                    | `__exo__`            | 10 (hand-authored, locked)      | **STRICT**               | **0% — ANY drop is error**   | `MS365_MCP_ACCEPT_EXO_CHURN`        |
| SharePoint Admin   | `sp-admin`               | `__spadmin__`        | 15 (hand-authored, locked)      | **STRICT**               | **0% — ANY drop is error**   | `MS365_MCP_ACCEPT_SPADMIN_CHURN`    |

Notes on naming:
- The `sp-admin` product enum member uses a dash (idiomatic); the `__spadmin__` alias prefix omits the dash (per `VALID_PREFIX_RE` in `bin/modules/run-product-pipeline.mjs`, which forbids dashes in prefix literals). This mapping is documented in `src/lib/auth/products.ts` JSDoc and pinned by tests P5 / P7 in `test/lib/auth/products.test.ts`.
- Baseline op counts marked "TBD" are populated by the first full-coverage run (`MS365_MCP_FULL_COVERAGE=1 MS365_MCP_USE_SNAPSHOT=1 npm run generate && npm run verify:coverage`). Power BI's count depends on upstream's OpenAPI schema shape; hand-authored products (Power Apps, Power Automate, Exchange Admin, SharePoint Admin) have known bounded counts from their spec files under `openapi/openapi-*.yaml`.

## Coverage Update Protocol

1. **First full-coverage run** (`MS365_MCP_FULL_COVERAGE=1 MS365_MCP_USE_SNAPSHOT=1 npm run generate`): coverage-check.mjs auto-populates initial per-product counts into `bin/.last-coverage-snapshot.json`. Update the "TBD" rows in this file with the Power BI count observed on that first run.
2. **Subsequent runs**: regression checks consult `PRODUCT_POLICIES[workload]` from `bin/modules/coverage-check.mjs`:
   - **Permissive** products (Graph, Power BI, Power Apps, Power Automate) warn on a 5-10% drop and error at 10%+.
   - **Strict** products (Exchange Admin, SharePoint Admin) error at ANY drop — any op removal requires an explicit operator opt-in.
3. **Legitimate upstream removals**:
   - Permissive: regenerate → new snapshot lands automatically once the drop is <10%; warning preserved in the markdown report.
   - Strict: operator MUST set `MS365_MCP_ACCEPT_<PRODUCT>_CHURN=1` AND update this GAP file with the new baseline op count and a changelog entry under ## Last Review.
4. **Legitimate upstream additions**:
   - Permissive: auto-accepted; baseline updates on regen.
   - Strict: same env var + GAP file update (strict policy fires on any delta, additions included).
5. **Coverage harness regressions** are always CI-blocking — there is no bypass path via env var at verify time. Operators resolving a legitimate drop must update the baseline snapshot AND this file in the same PR.

## CI Gating

`npm run verify:coverage` runs:
1. Codegen churn guards per plans 5.1-02..06 — enforce `MS365_MCP_ACCEPT_<PRODUCT>_CHURN=1` on deltas during regen.
2. Coverage harness `runCoverageCheck(src/generated/client.ts, bin/.last-coverage-snapshot.json)` — enforces per-product regression thresholds via `PRODUCT_POLICIES`.

CI green requires BOTH guards to pass. Operators wanting to bypass the codegen churn guard MUST also keep the coverage harness green — typically by regenerating against a spec that matches the new snapshot, not by setting multiple env vars to hide a real regression.

## Last Review

| Date       | Reviewer | Change                                                              |
| ---------- | -------- | ------------------------------------------------------------------- |
| 2026-04-21 | plan 5.1-08 executor | Initial baseline commit — Phase 5.1 close-out. Power BI count TBD pending first full-coverage run. |

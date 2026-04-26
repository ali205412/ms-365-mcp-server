# Full Codebase Review Fix Summary

Date: 2026-04-26

Source review: `FULL-CODEBASE-REVIEW.md`

## Status

All P0 and P1 findings from the full-codebase review have been fixed and committed.

The follow-up pass also fixed the highest-confidence P2/P3 issues that were small enough to close safely without redesigning larger subsystems.

## Fix Commits

- `b680b4d fix(ci): restrict claude workflow triggers`
  - Closed P0-1 by restricting the Claude workflow to trusted actors and reducing write-capable public trigger risk.
- `0e5628f fix(package): exclude local secrets from npm artifacts`
  - Closed P0-2 with npm package allowlisting and sensitive local file exclusions.
- `86b4613 fix(auth): require gateway key for app-only tenants`
  - Closed P0-3 by requiring caller authentication before app-only tenant token acquisition.
- `6e41549 fix(auth): verify bearer tokens before tenant access`
  - Closed P0-4 by verifying Microsoft bearer JWTs before tenant-local MCP access.
- `ee5cef6 fix(discovery): gate write and synthetic tool dispatch`
  - Closed P1-2 and P1-3 by keeping discovery execution tied to tenant enabled-tool gates and gating synthetic Graph-capable tools.
- `1c09189 fix(security): harden admin auth logs and shutdown`
  - Closed P1-1, P1-5, P1-6, P1-7, and P1-8 across Entra admin auth, body logging, legacy token exposure, parser limits, and shutdown hook handling.
- `2b508d6 fix(ci): enforce gates and harden deployment helpers`
  - Closed P1-4 and P1-11 through P1-18, plus P2-17/P2-19, by fixing product routing, consent-helper allowlisting, KEK rotation failures, product alias validation, reverse-proxy/admin/metrics examples, default credentials, CI quarantine, and OAuth coverage enforcement.
- `30c41a4 fix(auth): close tenant disable cache windows`
  - Closed P1-9 and P1-10 with first-use delta token serialization and tenant-disable API-key cache eviction/revocation.
- `6812117 fix(hardening): close review follow-up gaps`
  - Closed P2-1, P2-3, P2-6, P2-7, P2-12, P2-13, P2-14, P2-15, P2-18, P3-1, P3-2, and P3-3.
- `6ca44d8 style: satisfy formatting gate`
  - Fixed Prettier drift in branch-touched files so the CI `format:check` gate passes.

## Verification

- `npm test -- src/lib/admin/__tests__/api-keys.verify.test.ts test/tenant/disable-cascade.test.ts`
- `npm run test:int -- src/lib/delta/__tests__/with-delta-token.concurrency.int.test.ts src/lib/delta/__tests__/with-delta-token.int.test.ts src/lib/delta/__tests__/with-delta-token.resync.int.test.ts src/lib/admin/__tests__/tenants.rotate.int.test.ts`
- `npm test -- test/odata-nextlink.test.ts test/bin/migrate.test.mjs test/dockerfile.test.ts test/lib/trust-proxy.test.ts test/retry-handler.test.ts test/mcp-logging/logging.test.ts`
- `npm run test:int -- src/lib/admin/__tests__/enabled-tools-patch.int.test.ts`
- `npm test -- test/tool-selection/discovery-v1-surface.test.ts test/graph-batch-tool.test.ts`
- `bash -n bin/azure-grant-mcp-permissions.sh`
- `npm run generate` with the CI full-coverage Graph/product catalog environment
- `npm run build`
- `npm run lint`
- `npm run format:check`

Node 22 was used for Testcontainers-backed integration tests because the local default Node 18 runtime is below the repository engine target and lacks globals expected by current Testcontainers dependencies.

## Remaining Follow-Up

These findings are intentionally left as follow-up work because each needs a broader subsystem change or operator-facing migration rather than a small review patch:

- P2-2: regenerate/modernize static presets against the current generated catalog and decide whether static presets should remain first-class now that discovery mode is the default path.
- P2-4: wire server-side delegated refresh sessions into the live Graph retry path.
- P2-5: rework `TenantPool` cache keys and secret resolution so rotated tenant fields cannot stay stale.
- P2-8: scope the ETag cache by tenant and identity rather than resource path alone.
- P2-9: add per-tenant stream/session caps plus idle/absolute TTL cleanup.
- P2-10: add active-tenant guards and audit rows for memory admin mutations.
- P2-11: add subscription lifecycle compensation around remote Graph side effects and local DB persistence.
- P2-16: modernize the Azure Container Apps example for the v2 gateway, Postgres, Redis, KEK, and tenant-scoped OAuth routes.
- P3-4: remove or explicitly opt into the global permissive stdio test fallback.

# Contributing

## Branching

This fork (`ali205412/ms-365-mcp-server`) follows a **dev → main** flow:

- `main` — stable; source of production container image (`ghcr.io/ali205412/ms-365-mcp-server:latest`) and semantic-release tags.
- `dev` — integration branch; all feature work targets this branch first.
- Feature branches — `feat/*`, `fix/*`, `refactor/*`, `docs/*` — branch from `dev`, PR back to `dev`.

PR flow:

1. Branch from `dev`: `git checkout -b feat/my-feature dev`
2. Open PR → `dev`. `build.yml` + `integration.yml` + `codeql.yml` + `docker-image.yml` run.
3. After merge to `dev`, maintainers cut a PR `dev` → `main` for release.
4. Merge to `main` triggers `release.yml` (semantic-release tag + changelog) and a versioned Docker image.

## Local setup

```bash
nvm use              # Node 22 LTS
npm ci
MS365_MCP_FULL_COVERAGE=1 MS365_MCP_USE_SNAPSHOT=1 npm run generate
npm run verify       # lint + format:check + build + test
```

### Running the gateway

```bash
cp .env.example .env
# Fill in: MS365_MCP_CLIENT_ID, MS365_MCP_TENANT_ID, POSTGRES_PASSWORD,
# MS365_MCP_KEK, MS365_MCP_ADMIN_GROUP_ID (see README).
docker compose up -d
```

### Running integration tests locally

```bash
MS365_MCP_INTEGRATION=1 npm test           # Testcontainers-backed
node bin/check-oauth-coverage.mjs          # D-10 70% coverage gate
```

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/). Types in use:
`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`, `style`.

Scope suggestions: phase plan IDs (`06-04`), feature areas (`auth`, `rate-limit`, `metrics-server`), or service names. Examples:

```
feat(rate-limit): add sliding-window primitive
fix(retry): emit mcp_graph_throttled_total only on terminal 429
refactor(otel): extract labelForTool to dependency-free module
```

## Code style

- TypeScript strict + ESM (`.js` extension in imports — NodeNext).
- Prettier (`.prettierrc`) + ESLint (`eslint.config.js`). Run `npm run lint:fix && npm run format`.
- **No secrets in logs** — use the `redact` helper for any object containing tokens or passwords.
- **No console.log in production code paths** — use Winston / pino via `src/logger.ts`.

## Planning artifacts

This project uses [GSD](https://github.com/softeria/get-shit-done) for phase-based planning. Contents under `.planning/` are local-only by default (gitignored); specific phases are committed on-demand via `git add -f` when long-lived planning artifacts need sharing.

## Releasing (maintainers only)

```bash
git checkout main
git merge --no-ff dev
git push origin main        # triggers release.yml → semantic-release → tag
```

The Docker image workflow (`docker-image.yml`) will pick up the tag and publish `:X.Y.Z`, `:X.Y`, `:X`, and refresh `:latest`.

## Where to ask

- Issues: https://github.com/ali205412/ms-365-mcp-server/issues (fork-specific)
- Upstream issues: https://github.com/softeria/ms-365-mcp-server/issues
- Softeria Discord: https://discord.gg/WvGVNScrAZ

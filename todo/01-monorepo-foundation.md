# PR 01 — Monorepo foundation

**Branch:** `feat/01-monorepo-foundation` · **Depends on:** — · **Size:** S

## Why
Every later PR needs a working workspace, shared TypeScript config, one linter and CI. Get this right once so that each package is about 5 lines of config.

## Scope
- pnpm workspaces + Turborepo
- Shared `tsconfig` base (strict)
- Biome for lint and format (replaces ESLint + Prettier)
- Vitest workspace
- Empty Next.js 16 app at `apps/web` that builds and renders "Sutra"
- Empty package skeletons: `config`, `domain`, `db`, `agents`, `sources`, `mail`, `compliance`
- GitHub Actions CI

## Files
```
package.json               # root scripts only, "packageManager": "pnpm@<pinned>"
pnpm-workspace.yaml        # apps/*, packages/*
turbo.json                 # build, dev, lint, typecheck, test pipelines
tsconfig.base.json         # strict, noUncheckedIndexedAccess, verbatimModuleSyntax
biome.json                 # recommended + noProcessEnv (except packages/config)
vitest.workspace.ts
.nvmrc                     # Node 22 LTS
.gitignore  .editorconfig
.github/workflows/ci.yml
apps/web/                  # create-next-app (App Router, TS, Tailwind, src/ off, turbopack)
packages/<name>/package.json   # "name": "@sutra/<name>", "type": "module", exports → ./src/index.ts
packages/<name>/tsconfig.json  # { "extends": "../../tsconfig.base.json" }
packages/<name>/src/index.ts
```

## Design notes
- **No build step for internal packages.** Export TypeScript source (`"exports": {".": "./src/index.ts"}`) and set `transpilePackages: ['@sutra/*']` in `next.config.ts`. That's less config, and changes are instant.
- There is a single app (`apps/web`); everything else is a package.
- Root scripts:
  ```json
  { "dev": "turbo dev", "build": "turbo build", "lint": "biome check .",
    "format": "biome check --write .", "typecheck": "turbo typecheck", "test": "vitest run" }
  ```
- Biome override: `noProcessEnv` is **error** everywhere except `packages/config/**`.
- Pin exact dependency versions (`save-exact=true` in `.npmrc`).

## Tasks
- [ ] Init pnpm workspace, Turborepo, Biome, Vitest
- [ ] `create-next-app` into `apps/web`; remove boilerplate; add `transpilePackages`
- [ ] Scaffold the 7 packages with `index.ts` placeholders
- [ ] CI: install with cache → lint → typecheck → test → build
- [ ] Root `README.md` with a one-paragraph pitch + `pnpm i && pnpm dev`

## Acceptance criteria
- `pnpm i && pnpm dev` serves the app at `localhost:3000`
- `pnpm lint typecheck test build` all pass locally and in CI
- Importing `@sutra/domain` from `apps/web` works without a build step

## Out of scope
Docker, deploy (PR 18).

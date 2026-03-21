# Contributing to Xdrop

Thank you for helping improve Xdrop.

This repository follows the guidance from the Open Source Guides: we try to be explicit about
scope, expectations, and how to participate so contributors do not waste time on changes that are
unlikely to land.

## Project focus

Xdrop is focused on private file transfer with browser-side encryption.

Changes are most likely to be accepted when they improve one or more of these areas:

- privacy or security of the transfer flow
- reliability of uploads, downloads, expiry, or cleanup
- accessibility, usability, or performance of the current product surface
- test coverage, documentation, or developer experience
- operational hardening of the existing React + Go + Docker stack

Changes are less likely to be accepted if they significantly broaden the project into unrelated
product areas, add accounts/social features, or increase complexity without a clear privacy or
usability win.

## Before you start

- Read [README.md](README.md) for the current project status and local setup.
- Follow [MESSAGING.md](MESSAGING.md) when you touch README copy, homepage copy, SEO text, or
  other product-facing messaging.
- Search existing issues and pull requests before opening a new one.
- For substantial features, architecture changes, or API contract changes, open an issue first.
- For vulnerabilities or sensitive security concerns, follow [SECURITY.md](SECURITY.md) instead of
  filing a public issue.
- Keep general questions and troubleshooting in public channels when possible. See
  [SUPPORT.md](SUPPORT.md).

## Development setup

### Prerequisites

- Bun
- Go 1.26+
- Docker with Compose

### Install dependencies

```bash
bun install --frozen-lockfile
```

Use `.env.example` as the reference list of supported settings. Creating a local `.env` is
optional for the default dev stack; only set variables when you want to override Docker or API
defaults.

### Start the full stack

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

This brings up Xdrop, Postgres, Redis, and MinIO at `http://localhost:8080`.

### Run the frontend only

```bash
bun run dev:web
```

### Run the API only

```bash
cd apps/api
go run ./cmd/api
```

## What to run before opening a PR

Choose the checks that match your change:

### Frontend changes

```bash
bun run lint:web
bun run typecheck:web
bun run test:web
```

### Backend changes

```bash
cd apps/api
go test ./... -coverprofile=coverage.out -covermode=atomic
```

### Full-stack or user-flow changes

```bash
bun run test:e2e
```

### Formatting

```bash
bun run format:check
```

## Coding conventions

- Follow `.editorconfig`, Prettier, and Go formatting defaults.
- Use PascalCase for React components, `useX` for hooks, camelCase for TypeScript utilities, and
  lowercase package names in Go.
- Keep tests close to the code they cover.
- Prefer focused pull requests over broad drive-by refactors.
- Add or update tests when behavior changes.

## Pull request expectations

Please make it easy to review your change:

- Use a short imperative commit message, ideally in Conventional Commit style (`feat:`, `fix:`,
  `docs:`, `test:`).
- Explain the user-visible impact and any API, config, Docker, or data-model changes.
- List the verification steps you ran locally.
- Include screenshots or short recordings for UI changes.
- Update documentation when behavior, setup, or contributor workflows change.

If a change is large, split it into smaller reviewable steps whenever possible.

## Review and maintainer expectations

- Maintainers make the final call on whether a change fits the project vision.
- We aim to acknowledge new issues and pull requests within 7 days, but this is a part-time
  project, so response times can vary.
- If you have not heard back after a week, a polite follow-up in the same thread is welcome.
- A closed issue or PR is not a judgment on the contributor. It usually means the change does not
  currently fit scope, timing, or maintenance capacity.

## Good first contributions

If you are new to the project, good places to help include:

- improving docs and setup clarity
- adding or tightening frontend and API test coverage
- fixing accessibility issues
- polishing error states and recovery flows
- cleaning up rough edges in local development and CI

Thanks again for taking the time to contribute.

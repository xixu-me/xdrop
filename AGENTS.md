# Repository Guidelines

## Project Structure & Module Organization

`Xdrop` is a monorepo with a React frontend and Go API. Put browser code in `apps/web/src` (`app`, `components`, `features`, `lib`), public assets in `apps/web/public`, shared TypeScript helpers in `packages/shared/src`, and backend code in `apps/api` with the entrypoint at `apps/api/cmd/api` and domain packages under `apps/api/internal`. End-to-end tests live in `tests/e2e`, infra files in `infra`, and repo automation in `scripts` and `.github/workflows`.

## Build, Test, and Development Commands

Install JS dependencies once with `bun install --frozen-lockfile`.

- `bun run dev:web`: start the Vite dev server for the frontend.
- `bun run build:web`: type-check and build the web app, then generate SEO assets.
- `bun run lint:web`: run ESLint on `apps/web`.
- `bun run test:web` / `bun run test:web:coverage`: run Vitest, with or without coverage output.
- `bun run test:e2e`: run the Playwright suite in `tests/e2e`.
- `bun run format` / `bun run format:check`: run Prettier plus Go formatting checks.
- `go test ./... -coverprofile=coverage.out -covermode=atomic` from `apps/api`: run API tests the same way CI does.
- `go run ./cmd/api` from `apps/api`: run the API locally.
- `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`: boot the full stack on <http://localhost:8080>.

## Coding Style & Naming Conventions

Follow `.editorconfig`: 2 spaces for most files, tabs for `.go`, UTF-8, LF endings. Prettier enforces no semicolons, single quotes, and a 100-column wrap. Use PascalCase for React components, `useX` for hooks, camelCase for TS utilities, and lowercase Go package names. Keep tests beside the code they cover.

## Testing Guidelines

Frontend unit tests use Vitest, Testing Library, and `src/test/setup.ts`; name them `*.test.ts` or `*.test.tsx`. Browser flows use Playwright in `tests/e2e/*.spec.ts`. Backend tests use Go’s `testing` package, with integration coverage already present in `*_integration_test.go`. CI uploads frontend and backend coverage to Codecov; avoid reducing backend coverage below the current 90% target.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit style such as `feat:`, `fix:`, `test:`, and `docs:`. Keep commit subjects short and imperative. PRs should explain user-visible impact, link the relevant issue, and list verification steps. Include screenshots or short recordings for UI changes, and call out config, Docker, or API contract changes explicitly.

## Security & Configuration Tips

Start from `.env.example` for local configuration and never commit real secrets. The web dev server proxies `/api` to `localhost:8080` and `/xdrop` to MinIO on `localhost:9000`, so keep those endpoints aligned when changing local setup.

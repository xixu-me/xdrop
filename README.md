<img
  src="./apps/web/public/brand-lockup-horizontal.png"
  alt="Xdrop"
  height="200"
/>

[![Codecov coverage](https://codecov.io/github/xixu-me/xdrop/graph/badge.svg?token=Fi7TyvsID4)](https://codecov.io/github/xixu-me/xdrop)
[![GitHub Actions CI status](https://github.com/xixu-me/xdrop/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xixu-me/xdrop/actions/workflows/ci.yml)
[![CodeQL code scanning status](https://github.com/xixu-me/xdrop/actions/workflows/github-code-scanning/codeql/badge.svg?branch=main)](https://github.com/xixu-me/xdrop/actions/workflows/github-code-scanning/codeql)
[![Container image publish status](https://github.com/xixu-me/xdrop/actions/workflows/publish-images.yml/badge.svg?branch=main)](https://ghcr.io/xixu-me/xdrop)

Xdrop is an open source file transfer app that encrypts files in your browser and keeps
plaintext file names, contents, and keys off the server.

## Highlights

- End-to-end encryption in the browser before upload.
- Single-file and folder transfers, including local ZIP downloads for received folders.
- Resumable uploads with browser-local state for interrupted transfers.
- Expiring links, sender-side management, and optional privacy mode after upload.
- S3-compatible object storage support with PostgreSQL and Redis on the backend.

## How It Works

1. A sender creates a transfer in the browser. Xdrop generates a random transfer root key and a
   separate link key, optionally strips removable image metadata, then encrypts file chunks and
   the manifest in a dedicated Web Worker before upload.
2. The API creates the transfer record, returns a manage token plus upload limits, and presigns
   chunk upload URLs. PostgreSQL stores transfer/file/chunk metadata, Redis enforces rate limits,
   and S3-compatible storage keeps only encrypted blobs.
3. The sender shares a full link such as `/t/:transferId#k=...`. The `#k=...` fragment stays in
   the browser and is used to unwrap the transfer root key locally.
4. A recipient opens the link, fetches the encrypted manifest and chunk URLs, and decrypts the
   transfer entirely in the browser. Folder downloads can be re-packed into a ZIP locally.
5. Background cleanup periodically removes expired or deleted transfer objects from storage.

Xdrop keeps plaintext file names, paths, contents, and decryption keys off the server. The server
still sees operational metadata such as transfer timestamps, file counts, chunk counts, file
sizes, and rate-limit identifiers.

Key technical details:

- **Crypto model:** The browser generates 32-byte random secrets for the transfer root key and the
  share-link key. HKDF-SHA-256 derives separate AES-256-GCM keys for the manifest and for each
  file, and chunk encryption binds `transferId`, `fileId`, `chunkIndex`, size, and protocol
  version as authenticated data.
- **Chunked uploads:** The server advertises chunk size, file-count, and transfer-size limits to
  the browser. This repo defaults to 8 MiB chunks, up to 100 files, and a 256 MiB encrypted
  transfer size cap.
- **Resume behavior:** Xdrop persists source files locally in OPFS when available and falls back
  to IndexedDB-backed blobs for smaller transfers. Resume requests ask the API which chunks already
  exist so the browser only uploads missing work after a refresh or reopen.
- **Sender controls:** The manage token is returned once on creation and stored as a SHA-256 hash
  on the server. Local browser state keeps the share link, resume data, and sender-side actions
  such as extending expiry or deleting a transfer. Privacy mode can scrub those local controls
  after upload.
- **Backend responsibilities:** The API never decrypts payloads. Its job is to validate transfer
  state, rate-limit public and manage endpoints, issue presigned URLs, persist metadata, and purge
  expired or deleted transfer prefixes from object storage.

## System Architecture

```mermaid
flowchart LR
  subgraph Sender["Sender browser"]
    Select["Choose files or a folder"]
    Worker["Crypto worker<br/>AES-256-GCM + HKDF-SHA-256"]
    Local["OPFS / IndexedDB<br/>resume state and local controls"]
    Browser["Browser app<br/>React + upload/download runtime"]
    Select --> Worker
    Worker <--> Local
    Browser <--> Worker
    Browser <--> Local
  end

  subgraph Edge["Default Xdrop deployment"]
    nginx["nginx<br/>serves SPA and proxies /api + /xdrop"]
    API["Go API<br/>transfer lifecycle, presigning, cleanup"]
    nginx --> API
  end

  Postgres["PostgreSQL<br/>transfers, files, chunks, hashed manage tokens"]
  Redis["Redis<br/>rate limiting"]
  Storage["S3-compatible storage<br/>encrypted manifest and chunk objects"]
  Receiver["Receiver browser<br/>opens /t/:id#k=..."]

  Browser -->|create/register/finalize| nginx
  Browser -->|presigned PUT uploads| nginx
  API --> Postgres
  API --> Redis
  API -->|presigned PUT/GET URLs| Storage
  nginx -->|/xdrop proxy| Storage
  nginx -->|web app + public API| Receiver
  Receiver -->|presigned GET downloads| nginx
  Receiver -->|decrypts locally with #k fragment| Receiver
```

In the default Docker deployment, nginx serves the built frontend and proxies both `/api` and
`/xdrop`. If `S3_PUBLIC_ENDPOINT` points at a different public object-storage endpoint, presigned
upload and download traffic can bypass the nginx proxy while the rest of the architecture stays the
same.

## Deployment

This section is for deploying Xdrop to a cloud server.

### Recommended production topology

For a public deployment, run Xdrop behind a reverse proxy such as Caddy or nginx:

- The reverse proxy terminates HTTPS for your public domain.
- The `xdrop` container listens on a loopback-only host port such as `127.0.0.1:8080`.
- MinIO should not be exposed publicly. Bind MinIO ports to `127.0.0.1` only unless you have a
  specific reason to expose them.
- Set `S3_PUBLIC_ENDPOINT` and `ALLOWED_ORIGINS` to your public site URL, for example
  `https://xdrop.example.com`.

### 1. Get the files

If you only want to run the published image, you do not need to clone the whole repository on the
server. Download these deployment files:

```bash
mkdir -p xdrop/infra/minio
cd xdrop
curl -fsSL -o docker-compose.yml https://github.com/xixu-me/xdrop/raw/refs/heads/main/docker-compose.yml
curl -fsSL -o .env.example https://github.com/xixu-me/xdrop/raw/refs/heads/main/.env.example
curl -fsSL -o infra/minio/init.sh https://github.com/xixu-me/xdrop/raw/refs/heads/main/infra/minio/init.sh
chmod +x infra/minio/init.sh

If you want to build your own image, clone the repository instead so Docker has the full build
context (Dockerfile, app sources, packages, and infra files). In most cases, it is better to
build the image in CI or on a separate machine and only pull the final image on the server.

### 2. Review configuration

Install Docker and Docker Compose on the server, then review the xdrop service environment in
docker-compose.yml.

At minimum, update these values for your real deployment:

- S3_PUBLIC_ENDPOINT
- ALLOWED_ORIGINS

Typical production values look like this:

services:
  minio:
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"

  xdrop:
    ports:
      - "127.0.0.1:8080:80"
    environment:
      S3_PUBLIC_ENDPOINT: https://xdrop.example.com
      ALLOWED_ORIGINS: https://xdrop.example.com

Treat .env.example as the reference list of supported settings. The provided Compose file uses
inline environment values, so editing .env.example alone does not change the running stack.

### 3. Use the published image

docker compose up -d

This uses ghcr.io/xixu-me/xdrop:latest (https://ghcr.io/xixu-me/xdrop).

This is enough for a working deployment when the published image already matches the frontend
build-time settings you want.

Important caveat:

- Frontend build-time values such as VITE_SITE_URL are baked into the image.
- If your deployment uses a different public domain and you care about canonical URLs, Open Graph
  metadata, JSON-LD, or sitemap generation, use your own rebuilt image instead of the published one.

### 4. Optional: use your own prebuilt image

Set XDROP_IMAGE if you want the server to run a different prebuilt image:

XDROP_IMAGE=ghcr.io/your-org/xdrop:your-tag docker compose up -d

### 5. Optional: build your own image

Build your own image when you need custom frontend build-time settings such as VITE_SITE_URL or
VITE_API_BASE_URL:

git clone https://github.com/xixu-me/xdrop.git
cd xdrop
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

Edit the build args in docker-compose.build.yml before you run that command.

Example:

services:
  xdrop:
    build:
      args:
        VITE_SITE_URL: https://xdrop.example.com
        VITE_API_BASE_URL: /api/v1

On low-memory servers, building the image directly on the host may be slow or fail due to memory
pressure. In that case, build elsewhere, push the image to a registry, and deploy it with
XDROP_IMAGE.

### 6. Put Xdrop behind a reverse proxy

Example Caddyfile:

xdrop.example.com {
  encode gzip zstd
  reverse_proxy 127.0.0.1:8080
}

Then reload Caddy:

systemctl reload caddy

After the stack starts, open https://xdrop.example.com.

### Production notes

- The final container serves the built frontend with nginx and runs the Go API in the same
  container.
- The stack includes xdrop, postgres, redis, minio, and the bucket bootstrap container.
- MinIO is intended to be private in the default single-host deployment.
- Public traffic should normally hit only the reverse proxy on ports 80 and 443.

## Development

### Prerequisites

- Node.js and npm
- Go 1.26+
- Docker / Docker Compose

### 1. Install dependencies

```bash
npm ci
```

### 2. Start backing services

For local development, start PostgreSQL, Redis, and MinIO with Docker:

```bash
docker compose up -d postgres redis minio minio-setup
```

### 3. Run the API

```bash
cd apps/api
go run ./cmd/api
```

### 4. Run the web app

From the repo root in a second terminal:

```bash
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173). During local development, the Vite dev
server proxies:

- `/api` to `http://localhost:8080`
- `/xdrop` to `http://localhost:9000`

This keeps frontend hot reload while talking to the local Go API and MinIO.

## Testing

### Web

```bash
npm run lint:web
npm run typecheck:web
npm run test:web
npm run test:web:coverage
npm run build:web
```

### End-to-end

Install Playwright browsers once if needed:

```bash
npm run test:e2e:install
```

The E2E suite expects Xdrop to be running at `http://localhost:8080` by default and shells into
the local `postgres` and `redis` Compose services during the tests. Start the full stack first:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Then run the suite:

```bash
npm run test:e2e
```

Set `E2E_BASE_URL` and `E2E_API_URL` if you want to target a different environment.

### API

From `apps/api`:

```bash
go test ./... -coverprofile=coverage.out -covermode=atomic
```

Some API integration tests use Docker-backed testcontainers. If Docker is unavailable, those tests
are skipped and coverage will be lower than CI.

### Formatting

```bash
npm run format
npm run format:check
```

## Project Structure

```text
apps/
  api/        Go API
  web/        React frontend
packages/
  shared/     Shared TypeScript constants and helpers
tests/
  e2e/        Playwright end-to-end tests
infra/        Deployment and container configuration
scripts/      Repository automation and helper scripts
```

## Environment Variables

See [.env.example](./.env.example) for the full list. The most important settings are:

- `API_ADDR`
- `DATABASE_URL`
- `REDIS_ADDR`
- `S3_ENDPOINT`
- `S3_PUBLIC_ENDPOINT`
- `S3_BUCKET`
- `ALLOWED_ORIGINS`
- `VITE_API_BASE_URL`
- `VITE_SITE_URL`

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).

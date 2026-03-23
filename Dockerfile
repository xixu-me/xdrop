FROM --platform=$BUILDPLATFORM oven/bun:alpine AS web-build

WORKDIR /workspace

ARG VITE_SITE_URL=""
ARG VITE_API_BASE_URL="/api/v1"
ENV VITE_SITE_URL=${VITE_SITE_URL}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN bun install --frozen-lockfile
RUN bun run build:web

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS api-build

WORKDIR /src/apps/api

ARG TARGETOS
ARG TARGETARCH

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api ./

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -o /out/xdrop-api ./cmd/api

FROM nginx:1.29-alpine

COPY infra/xdrop/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 infra/xdrop/entrypoint.sh /usr/local/bin/xdrop-entrypoint
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
COPY --from=api-build /out/xdrop-api /usr/local/bin/xdrop-api

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/xdrop-entrypoint"]

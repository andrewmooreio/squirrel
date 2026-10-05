# syntax=docker/dockerfile:1

# Build the stylesheet with the Tailwind standalone CLI (no Node.js).
FROM --platform=$BUILDPLATFORM debian:trixie-slim AS css
ARG TAILWIND_VERSION=v4.3.3
ARG BUILDARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN case "$BUILDARCH" in arm64) tw=arm64 ;; *) tw=x64 ;; esac \
    && curl -sSfL -o /usr/local/bin/tailwindcss \
       "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/tailwindcss-linux-${tw}" \
    && chmod +x /usr/local/bin/tailwindcss
WORKDIR /src
COPY internal/web/css internal/web/css
COPY internal/web/views internal/web/views
RUN tailwindcss -i internal/web/css/input.css -o /app.css --minify

# Build a static Go binary. Generated templ files are committed, and CI
# checks that they are up to date.
FROM --platform=$BUILDPLATFORM golang:1.27 AS build
ARG TARGETOS
ARG TARGETARCH
# The release workflow passes the version. The build context has no .git.
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=css /app.css internal/web/static/app.css
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X github.com/andrewmooreio/squirrel/internal/version.Version=${VERSION}" -o /squirrel .

# Create the data directory owned by the non-root user.
FROM --platform=$BUILDPLATFORM busybox:stable AS data
RUN mkdir /data && chown 65532:65532 /data

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /squirrel /squirrel
COPY --from=data --chown=65532:65532 /data /data
ENV SQUIRREL_DB_PATH=/data/squirrel.db
VOLUME /data
EXPOSE 8080
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/squirrel", "healthcheck"]
ENTRYPOINT ["/squirrel"]

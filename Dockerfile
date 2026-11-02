# syntax=docker/dockerfile:1

# Build the stylesheet and the Node bundle. The output is plain JavaScript, so
# the build runs once on the build platform for every target architecture.
FROM --platform=$BUILDPLATFORM node:26-slim AS build
# The release workflow passes the version. The build context has no .git.
ARG VERSION=dev
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN VERSION=${VERSION} npm run build

# Create the data directory owned by the non-root user.
FROM --platform=$BUILDPLATFORM busybox:stable AS data
RUN mkdir /data && chown 65532:65532 /data

FROM gcr.io/distroless/nodejs26-debian13:nonroot
WORKDIR /app
COPY --from=build /src/dist/node dist/node
COPY --from=build /src/dist/assets dist/assets
COPY --from=data --chown=65532:65532 /data /data
ENV DATABASE_URL=sqlite:///data/squirrel.db
VOLUME /data
EXPOSE 8080
USER 65532:65532
# The image has no shell or curl, so the health check runs a Node script.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "dist/node/healthcheck.mjs"]
CMD ["dist/node/server.mjs"]

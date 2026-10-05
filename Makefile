TAILWIND_VERSION ?= v4.3.3
GOLANGCI_LINT_VERSION ?= v2.14.0

BIN := $(CURDIR)/bin
TAILWIND := $(BIN)/tailwindcss
GOLANGCI_LINT := $(BIN)/golangci-lint

UNAME_S := $(shell uname -s | tr '[:upper:]' '[:lower:]')
UNAME_M := $(shell uname -m)
TW_OS := $(if $(filter darwin,$(UNAME_S)),macos,linux)
TW_ARCH := $(if $(filter arm64 aarch64,$(UNAME_M)),arm64,x64)

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' | grep . || echo dev)
LDFLAGS_VERSION := -X github.com/andrewmooreio/squirrel/internal/version.Version=$(VERSION)

CSS_IN := internal/web/css/input.css
CSS_OUT := internal/web/static/app.css

.PHONY: all generate css css-watch test lint run build tools clean

all: generate css build

## generate: run templ code generation
generate:
	go tool templ generate

## css: build the Tailwind stylesheet
css: $(TAILWIND)
	$(TAILWIND) -i $(CSS_IN) -o $(CSS_OUT) --minify

## css-watch: rebuild the stylesheet on change
css-watch: $(TAILWIND)
	$(TAILWIND) -i $(CSS_IN) -o $(CSS_OUT) --watch

## test: run all tests
test:
	go test -race ./...

## lint: run golangci-lint
lint: $(GOLANGCI_LINT)
	$(GOLANGCI_LINT) run

## run: generate, build CSS and run locally against ./tmp/squirrel.db
run: generate css
	@mkdir -p tmp
	SQUIRREL_DB_PATH=$${SQUIRREL_DB_PATH:-./tmp/squirrel.db} go run -ldflags "$(LDFLAGS_VERSION)" .

## build: build the binary into ./bin/squirrel
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w $(LDFLAGS_VERSION)" -o $(BIN)/squirrel .

## tools: download the Tailwind and golangci-lint binaries
tools: $(TAILWIND) $(GOLANGCI_LINT)

$(TAILWIND):
	@mkdir -p $(BIN)
	curl -sSfL -o $@ https://github.com/tailwindlabs/tailwindcss/releases/download/$(TAILWIND_VERSION)/tailwindcss-$(TW_OS)-$(TW_ARCH)
	chmod +x $@

$(GOLANGCI_LINT):
	@mkdir -p $(BIN)
	curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b $(BIN) $(GOLANGCI_LINT_VERSION)

clean:
	rm -rf $(BIN) tmp $(CSS_OUT)

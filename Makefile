SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

PYTHON ?= python3
TOOLS_DIR := .tools
TOOL ?= $(TOOLS_DIR)/bin/caudra-models
PIN := caudra.toml
MODELS_DEV_URL := https://models.dev/api.json
MODELS_DEV_JSON := $(TOOLS_DIR)/models-dev.json
COMMIT_PATTERN := ^[0-9a-f]{40}$$

pin = $(shell $(PYTHON) -c 'import sys, tomllib; value = tomllib.load(open("$(PIN)", "rb"))["tool"][sys.argv[1]]; print(",".join(value) if isinstance(value, list) else value)' $(1))
INSTALL = install --locked --root $(abspath $(TOOLS_DIR)) --features $(call pin,features)
BUILD = $(TOOL) build . $(if $(NOW),--now $(NOW))

.PHONY: help tool require-tool check build import audit hooks

help: ## List the targets
	@awk -F ':.*## ' '/^[a-z-]+:.*## /{printf "  %-8s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

tool: ## Install caudra-models into .tools/bin from caudra.toml, or from CAUDRA_SRC=<caudra checkout>
ifdef CAUDRA_SRC
	cd $(CAUDRA_SRC) && cargo $(INSTALL) --path caudra-models
else
	@rev='$(call pin,rev)'; [[ $$rev =~ $(COMMIT_PATTERN) ]] || { \
		echo "$(PIN): [tool] rev is not a full commit hash ($$rev). Pin it, or run make tool CAUDRA_SRC=<caudra checkout>." >&2; exit 1; }
	rustup toolchain install $(call pin,toolchain) --profile minimal
	cargo +$(call pin,toolchain) $(INSTALL) --git $(call pin,git) --rev $(call pin,rev) caudra-models
endif

require-tool:
	@command -v $(TOOL) >/dev/null || { echo "$(TOOL) not found: run make tool first" >&2; exit 1; }

check: require-tool ## Validate the data and fail if dist/ or schema/ is stale
	$(TOOL) validate .

build: require-tool ## Write dist/ and schema/ (NOW=<RFC 3339> stamps a changed snapshot)
	$(BUILD)

import: require-tool ## Download models.dev, refresh import/models-dev.json, and build
	mkdir -p $(TOOLS_DIR)
	curl --fail --silent --show-error --location --max-time 120 --output $(MODELS_DEV_JSON) $(MODELS_DEV_URL)
	$(TOOL) import-models-dev $(MODELS_DEV_JSON) .
	$(BUILD)

audit: ## Placeholder until the audit moves to this repository
	@echo "audit moves here in a later change"

hooks: ## Install a pre-commit hook that runs make check
	@hook="$$(git rev-parse --git-path hooks)/pre-commit"; \
		printf '#!/usr/bin/env bash\nexec make check\n' > "$$hook"; \
		chmod +x "$$hook"; \
		echo "installed $$hook"

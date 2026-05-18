PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin
PYTHON_BIN ?= /data/conda/bin/python
EXTRA_PYTHONPATH ?= /tmp/codex_openpyxl_py313
REPO_ROOT := $(abspath ..)

.PHONY: install-local
install-local:
	@mkdir -p "$(BIN_DIR)"
	@printf '%s\n' '#!/usr/bin/env bash' \
		'set -euo pipefail' \
		'export PYTHONPATH="$(REPO_ROOT):$(EXTRA_PYTHONPATH)$${PYTHONPATH:+:$${PYTHONPATH}}"' \
		'exec "$(PYTHON_BIN)" -m codex_agents.cli "$$@"' \
		> "$(BIN_DIR)/cad-sim-pipeline"
	@chmod +x "$(BIN_DIR)/cad-sim-pipeline"
	@printf 'installed %s\n' "$(BIN_DIR)/cad-sim-pipeline"

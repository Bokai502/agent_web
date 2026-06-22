PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin
PYTHON_BIN ?= /data/conda/envs/lbk/bin/python3
TOOL_ROOT := $(abspath .)
PYTHONPATH_VALUE := $(TOOL_ROOT)/src

.PHONY: install-local
install-local:
	@mkdir -p "$(BIN_DIR)"
	@printf '%s\n' '#!/usr/bin/env bash' \
		'set -euo pipefail' \
		'exec env PYTHONPATH="$(PYTHONPATH_VALUE):$${PYTHONPATH:-}" "$(PYTHON_BIN)" -m cad_cli.cli "$$@"' \
		> "$(BIN_DIR)/cad_cli"
	@chmod +x "$(BIN_DIR)/cad_cli"
	@printf 'installed %s\n' "$(BIN_DIR)/cad_cli"

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
		'exec env PYTHONPATH="$(PYTHONPATH_VALUE):$${PYTHONPATH:-}" "$(PYTHON_BIN)" -m sim_cli_tools.cli.main "$$@"' \
		> "$(BIN_DIR)/sim-run"
	@chmod +x "$(BIN_DIR)/sim-run"
	@printf '%s\n' '#!/usr/bin/env bash' \
		'set -euo pipefail' \
		'exec env PYTHONPATH="$(PYTHONPATH_VALUE):$${PYTHONPATH:-}" "$(PYTHON_BIN)" -m sim_cli_tools.cli.comsol_progress "$$@"' \
		> "$(BIN_DIR)/sim-comsol-progress"
	@chmod +x "$(BIN_DIR)/sim-comsol-progress"
	@rm -f "$(BIN_DIR)/sim-run-03-06"
	@printf 'installed %s\n' "$(BIN_DIR)/sim-run"
	@printf 'installed %s\n' "$(BIN_DIR)/sim-comsol-progress"

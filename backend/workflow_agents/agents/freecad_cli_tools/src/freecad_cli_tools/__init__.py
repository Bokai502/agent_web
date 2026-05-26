"""
FreeCAD CLI Tools - A shared package for FreeCAD command-line utilities.

This package provides common utilities for interacting with FreeCAD via XML-RPC.
"""

__version__ = "0.11.0"
__author__ = "FreeCAD MCP Team"

from .rpc_client import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    FreeCADConnection,
    add_connection_args,
    get_connection,
    print_result,
)

__all__ = [
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "FreeCADConnection",
    "add_connection_args",
    "get_connection",
    "print_result",
]

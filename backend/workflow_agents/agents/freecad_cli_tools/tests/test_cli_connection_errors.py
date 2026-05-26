from __future__ import annotations

import errno
import socket
import xmlrpc.client

import pytest

from freecad_cli_tools import cli_support
from freecad_cli_tools.cli_support import format_rpc_connection_error


def test_format_rpc_connection_error_for_connection_refused() -> None:
    error = ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    message = format_rpc_connection_error(error, "localhost", 9877)

    assert "localhost:9877" in message
    assert "connection refused" in message.lower()
    assert "FreeCAD MCP addon" in message


def test_format_rpc_connection_error_for_host_resolution_failure() -> None:
    error = socket.gaierror(-2, "Name or service not known")

    message = format_rpc_connection_error(error, "bad-host", 9877)

    assert "bad-host" in message
    assert "cannot resolve host" in message.lower()


def test_format_rpc_connection_error_for_protocol_error() -> None:
    error = xmlrpc.client.ProtocolError(
        "http://localhost:9877",
        404,
        "Not Found",
        {},
    )

    message = format_rpc_connection_error(error, "localhost", 9877)

    assert "localhost:9877" in message
    assert "Cannot connect to FreeCAD RPC server" in message


def test_execute_script_payload_wraps_connection_failure(monkeypatch) -> None:
    def fake_call_rpc_method(*args, **kwargs):
        raise ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused")

    monkeypatch.setattr(cli_support, "call_rpc_method", fake_call_rpc_method)

    with pytest.raises(
        RuntimeError, match="Cannot connect to FreeCAD RPC server at localhost:9877"
    ):
        cli_support.execute_script_payload("localhost", 9877, "print('hi')")

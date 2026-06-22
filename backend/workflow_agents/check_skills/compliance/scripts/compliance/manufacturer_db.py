from __future__ import annotations

from typing import Any

import psycopg2.extras

from .reliability_db import PostgresReliabilityConfig, _connect


def query_manufacturer_rows(
    config: PostgresReliabilityConfig | None = None,
) -> list[dict[str, Any]]:
    config = config or PostgresReliabilityConfig()
    sql = """
select
  id::text as id,
  full_name::text as full_name,
  main_products::text as main_products
from public.manufacturer
where full_name is not null and btrim(full_name::text) <> ''
order by id
"""
    with (
        _connect(config) as conn,
        conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur,
    ):
        cur.execute(sql)
        return [_clean_row(dict(row)) for row in cur.fetchall()]


def query_manufacturer_alias_rows(
    config: PostgresReliabilityConfig | None = None,
) -> list[dict[str, Any]]:
    config = config or PostgresReliabilityConfig()
    sql = """
select
  a.alias_name::text as alias,
  m.full_name::text as full_name,
  m.id::text as manufacturer_id,
  'manufacturer_alias' as source
from public.manufacturer_alias a
join public.manufacturer m
  on m.id = a.manufacturer_id
where a.alias_name is not null
  and btrim(a.alias_name::text) <> ''
"""
    with (
        _connect(config) as conn,
        conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur,
    ):
        cur.execute(sql)
        return [_clean_row(dict(row)) for row in cur.fetchall()]


def _clean_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        str(key): "" if value is None else str(value).strip()
        for key, value in row.items()
    }

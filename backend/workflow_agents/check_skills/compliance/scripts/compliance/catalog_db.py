from __future__ import annotations

import os
import re
import json
from dataclasses import dataclass
from typing import Any

import psycopg2
import psycopg2.extras

from .app_config import compliance_database_config
from .schema import ComponentRecord


def _catalog_config_value(key: str, default: str) -> str:
    data = compliance_database_config("catalog")
    env_name = f"CATALOG_POSTGRES_{key.upper()}"
    generic_env_name = f"POSTGRES_{key.upper()}"
    value = os.getenv(env_name) or os.getenv(generic_env_name) or data.get(key)
    return str(value if value is not None else default)


@dataclass
class PostgresCatalogConfig:
    dbname: str = _catalog_config_value("db", "components_db")
    user: str = _catalog_config_value("user", "postgres")
    password: str = _catalog_config_value("password", "lbk123")
    host: str = _catalog_config_value("host", "10.110.10.101")
    port: str = _catalog_config_value("port", "5432")
    recall_limit_per_component: int = int(
        os.getenv("CATALOG_POSTGRES_RECALL_LIMIT")
        or compliance_database_config("catalog").get("recallLimitPerComponent")
        or compliance_database_config("catalog").get("recall_limit_per_component")
        or 80
    )


def query_catalog_rows(config: PostgresCatalogConfig | None = None) -> list[dict[str, Any]]:
    config = config or PostgresCatalogConfig()
    sql = """
select
  id::text as id,
  name::text as name,
  model::text as model,
  manufacturer::text as manufacturer,
  'component_series' as source_table
from component_series
where name is not null or model is not null or manufacturer is not null
union all
select
  id::text as id,
  name::text as name,
  model::text as model,
  manufacturer::text as manufacturer,
  'component_series_outside' as source_table
from component_series_outside
where name is not null or model is not null or manufacturer is not null
"""
    with _connect(config) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [_clean_row(dict(row)) for row in cur.fetchall()]


def query_catalog_candidate_rows(
    components: list[ComponentRecord],
    config: PostgresCatalogConfig | None = None,
) -> list[dict[str, Any]]:
    """Fetch a bounded PostgreSQL candidate set for catalog matching.

    The original web flow recalled a small set of catalog ids before looking up
    component_series details.  This keeps the standalone pipeline close to that
    behavior without requiring the RAGFlow service: PostgreSQL does the first
    pass by model/name/manufacturer terms, then checks.py performs the existing
    detailed scoring and final candidate ranking.
    """
    config = config or PostgresCatalogConfig()
    tables = ("component_series", "component_series_outside")
    limit = max(1, min(int(config.recall_limit_per_component or 80), 500))
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    with _connect(config) as conn:
        table_columns = {table: _table_columns(conn, table) for table in tables}
        query_components = []
        for comp in components:
            query_components.append(
                {
                    "component_index": comp.index,
                    "query_model": comp.model,
                    "model_terms": _like_terms(comp.model, comp.name) or ["__NO_MODEL_MATCH__"],
                    "maker_terms": _like_terms(comp.manufacturer) or ["__NO_MAKER_MATCH__"],
                }
            )
        if not query_components:
            return []
        for row in _query_batched_component_candidates(conn, table_columns, query_components, limit):
            key = (row.get("source_table", ""), row.get("id", ""))
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    return rows


def _query_batched_component_candidates(
    conn,
    table_columns: dict[str, set[str]],
    query_components: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    selects = []
    params: dict[str, Any] = {
        "components": json.dumps(query_components, ensure_ascii=False),
        "limit": limit,
    }
    for table, columns in table_columns.items():
        if not columns:
            continue
        selects.append(_candidate_select_sql(table, columns))
    if not selects:
        return []

    sql = f"""
with input_components as (
  select *
  from jsonb_to_recordset(%(components)s::jsonb) as c(
    component_index int,
    query_model text,
    model_terms text[],
    maker_terms text[]
  )
)
select *
from input_components c
cross join lateral (
  {" union all ".join(selects)}
  order by recall_rank desc, source_table, id
  limit %(limit)s
) catalog
order by c.component_index, catalog.recall_rank desc, catalog.source_table, catalog.id
"""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        rows = []
        for row in cur.fetchall():
            item = _clean_row(dict(row))
            item["_query_component_index"] = item.pop("component_index", "")
            item["_query_model"] = item.pop("query_model", "")
            rows.append(item)
        return rows


def _candidate_select_sql(table: str, columns: set[str]) -> str:
    id_expr = _column_expr(columns, "id")
    name_expr = _column_expr(columns, "name")
    model_expr = _column_expr(columns, "model")
    manufacturer_expr = _column_expr(columns, "manufacturer")
    manufacturer_full_name_expr = _column_expr(columns, "manufacturer_full_name")
    group_expr = _column_expr(columns, "group")
    detail_expr = _json_text_expr(columns, "detail")
    subtype_expr = _column_expr(columns, "subtype")
    type_expr = _column_expr(columns, "type")
    table_name_expr = _column_expr(columns, "table_name")
    return f"""
select
  {id_expr} as id,
  {name_expr} as name,
  {model_expr} as model,
  {manufacturer_expr} as manufacturer,
  {manufacturer_full_name_expr} as manufacturer_full_name,
  {group_expr} as "group",
  {detail_expr} as detail,
  {subtype_expr} as subtype,
  {type_expr} as type,
  {table_name_expr} as table_name,
  '{table}' as source_table,
  (
    case when {model_expr} ilike any(c.model_terms) then 100 else 0 end +
    case when {name_expr} ilike any(c.model_terms) then 30 else 0 end +
    case when {manufacturer_expr} ilike any(c.maker_terms) then 20 else 0 end +
    case when {manufacturer_full_name_expr} ilike any(c.maker_terms) then 20 else 0 end
  ) as recall_rank
from {table}
where
  {model_expr} ilike any(c.model_terms)
  or {name_expr} ilike any(c.model_terms)
  or {manufacturer_expr} ilike any(c.maker_terms)
  or {manufacturer_full_name_expr} ilike any(c.maker_terms)
"""


def _column_expr(columns: set[str], column: str) -> str:
    if column in columns:
        return f"{_ident(column)}::text"
    return "''::text"


def _json_text_expr(columns: set[str], column: str) -> str:
    if column in columns:
        return f"{_ident(column)}::text"
    return "''::text"


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _table_columns(conn, table: str) -> set[str]:
    sql = """
select column_name
from information_schema.columns
where table_schema = current_schema() and table_name = %s
"""
    with conn.cursor() as cur:
        cur.execute(sql, (table,))
        return {row[0] for row in cur.fetchall()}


def _like_terms(*values: str) -> list[str]:
    terms: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        for term in _term_variants(text):
            pattern = f"%{term}%"
            if pattern not in terms:
                terms.append(pattern)
    return terms


def _term_variants(text: str) -> list[str]:
    compact = "".join(ch for ch in text if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")
    variants = [text]
    if compact and compact != text:
        variants.append(compact)
    for token in re.findall(r"[A-Za-z][A-Za-z0-9/_+.\-]{2,}|[\u4e00-\u9fff]{2,}|\d{2,}", text):
        variants.append(token)
    if compact:
        for length in (10, 8, 6, 4):
            if len(compact) > length:
                variants.append(compact[:length])
    return [item for item in variants if item]


def _connect(config: PostgresCatalogConfig):
    try:
        return psycopg2.connect(
            dbname=config.dbname,
            user=config.user,
            password=config.password,
            host=config.host,
            port=config.port,
            connect_timeout=10,
        )
    except UnicodeDecodeError as exc:
        raise RuntimeError(
            "PostgreSQL catalog connection failed while decoding the server error message. "
            "Check --catalog-pg-db/--catalog-pg-user/--catalog-pg-password/--catalog-pg-host/--catalog-pg-port. "
            f"Original error: {exc}"
        ) from exc
    except psycopg2.OperationalError as exc:
        raise RuntimeError(
            "PostgreSQL catalog connection failed. "
            f"db={config.dbname}, user={config.user}, host={config.host}, port={config.port}. "
            f"Original error: {exc}"
        ) from exc


def _clean_row(row: dict[str, Any]) -> dict[str, str]:
    return {str(key): "" if value is None else str(value).strip() for key, value in row.items()}

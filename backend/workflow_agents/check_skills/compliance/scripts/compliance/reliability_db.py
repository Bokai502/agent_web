from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Literal

import psycopg2
import psycopg2.extras

from .app_config import compliance_database_config
from .schema import ComponentRecord


QueryType = Literal["quality", "radiation"]


def _reliability_config_value(key: str, default: str) -> str:
    data = compliance_database_config("reliability")
    value = os.getenv(f"POSTGRES_{key.upper()}") or data.get(key)
    return str(value if value is not None else default)


@dataclass
class PostgresReliabilityConfig:
    dbname: str = _reliability_config_value("db", "satllm_db")
    user: str = _reliability_config_value("user", "postgres")
    password: str = _reliability_config_value("password", "lbk123")
    host: str = _reliability_config_value("host", "localhost")
    port: str = _reliability_config_value("port", "5432")
    schema: str = _reliability_config_value("schema", "staging")
    limit_per_component: int = int(
        os.getenv("COMPLIANCE_RELIABILITY_QUERY_LIMIT")
        or compliance_database_config("reliability").get("limitPerComponent")
        or compliance_database_config("reliability").get("limit_per_component")
        or 5
    )


def query_postgres_reliability(
    components: list[ComponentRecord],
    config: PostgresReliabilityConfig | None = None,
) -> list[dict[str, Any]]:
    config = config or PostgresReliabilityConfig()
    with _connect(config) as conn:
        quality = [_query_component(conn, config, comp, "quality") for comp in components]
        radiation = [_query_component(conn, config, comp, "radiation") for comp in components]
    return _combine(quality, radiation)


def load_postgres_components(config: PostgresReliabilityConfig | None = None, limit: int | None = None) -> list[ComponentRecord]:
    config = config or PostgresReliabilityConfig()
    sql = """
select
  component_model,
  component_name,
  category_class,
  category_name,
  is_key_part,
  quality_level,
  is_low_quality,
  package_type,
  working_temp,
  manufacturer_name,
  flight_status
from public.component
where component_model is not null or component_name is not null
order by id
"""
    params: tuple[Any, ...] = ()
    if limit:
        sql += " limit %s"
        params = (limit,)
    with _connect(config) as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        rows = [dict(row) for row in cur.fetchall()]

    records: list[ComponentRecord] = []
    for idx, row in enumerate(rows, 1):
        records.append(
            ComponentRecord(
                index=idx,
                model=_clean(row.get("component_model")),
                name=_clean(row.get("component_name")) or _clean(row.get("component_model")),
                quality_level=_clean(row.get("quality_level")),
                package_type=_clean(row.get("package_type")),
                working_temp=_clean(row.get("working_temp")),
                manufacturer=_clean(row.get("manufacturer_name")),
                flight_history=_clean(row.get("flight_status")),
                is_low_quality=bool(row.get("is_low_quality")),
                is_key_part=bool(row.get("is_key_part")),
                category_class=_clean(row.get("category_class")),
                category_name=_clean(row.get("category_name")),
            )
        )
    return records


def _clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _connect(config: PostgresReliabilityConfig):
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
            "PostgreSQL connection failed while decoding the server error message. "
            "The server is reachable, but the credentials or database settings are likely invalid. "
            f"Check --pg-db/--pg-user/--pg-password/--pg-host/--pg-port. Original error: {exc}"
        ) from exc
    except psycopg2.OperationalError as exc:
        raise RuntimeError(
            "PostgreSQL connection failed. "
            f"db={config.dbname}, user={config.user}, host={config.host}, port={config.port}. "
            f"Original error: {exc}"
        ) from exc


def _query_component(conn, config: PostgresReliabilityConfig, comp: ComponentRecord, query_type: QueryType) -> dict[str, Any]:
    limit = max(1, min(int(config.limit_per_component or 5), 100))
    if query_type == "quality":
        sql = _quality_sql(config.schema)
        params = _params(comp, limit)
    else:
        sql = _radiation_sql(config.schema)
        params = _params(comp, limit)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        rows = [dict(row) for row in cur.fetchall()]
    return {
        "index": comp.index,
        "component_name": comp.name,
        "model": comp.model,
        "manufacturer": comp.manufacturer,
        "count": len(rows),
        "match_type": "数据库命中" if rows else "未命中",
        "match_level": "数据库命中" if rows else "未命中",
        "match_level_code": "db_hit" if rows else "miss",
        "match_score": 100 if rows else 0,
        "matched_terms": ", ".join(_query_terms(comp)),
        "match_reason": "按型号、名称、厂家在可靠性数据库中检索。" if rows else "未检索到数据库记录。",
        "matched_models": ", ".join(dict.fromkeys(str(row.get("model") or "") for row in rows if row.get("model"))),
        "summary": _summary(query_type, rows),
        "records": rows,
        "sql_mode": "postgres",
    }


def _quality_sql(schema: str) -> str:
    return f"""
select
  c.component_name as component_name,
  c.model as model,
  c.component_type as component_type,
  c.manufacturer as manufacturer,
  c.batch as batch,
  c.quality_grade as quality_grade,
  q.quantity as quantity,
  q.issue_description as issue_description,
  r._source_file as source_file,
  r._source_sheet as source_sheet,
  r._source_table as source_table,
  r._source_row_number as source_row_number
from {schema}.cleaned_quality_issues q
join {schema}.cleaned_components c on c.component_uuid = q.component_uuid
left join {schema}.cleaned_records r on r.record_uuid = q.record_uuid
where (
  c.model ilike any(%(terms)s)
  or c.component_name ilike any(%(terms)s)
  or c.manufacturer ilike any(%(manufacturer_terms)s)
)
order by r._source_file nulls last, r._source_row_number nulls last
limit %(limit)s
"""


def _radiation_sql(schema: str) -> str:
    return f"""
select
  c.component_name as component_name,
  c.model as model,
  c.component_type as component_type,
  c.manufacturer as manufacturer,
  e.test_subject as test_subject,
  e.test_location as test_location,
  e.test_time as test_time,
  e.radiation_source as radiation_source,
  e.single_event_effects as single_event_effects,
  e.total_dose_effects as total_dose_effects,
  e.dose_rate_effects as dose_rate_effects,
  e.displacement_damage as displacement_damage,
  e.other_effects as other_effects,
  e.quantitative_data as quantitative_data,
  e.functional_impact as functional_impact,
  e.observed_phenomena as observed_phenomena,
  r._source_file as source_file,
  r._source_sheet as source_sheet,
  r._source_table as source_table,
  r._source_row_number as source_row_number
from {schema}.cleaned_radiation_effects e
join {schema}.cleaned_components c on c.component_uuid = e.component_uuid
left join {schema}.cleaned_records r on r.record_uuid = e.record_uuid
where (
  c.model ilike any(%(terms)s)
  or c.component_name ilike any(%(terms)s)
  or c.manufacturer ilike any(%(manufacturer_terms)s)
)
and (
  e.single_event_effects is not null
  or e.total_dose_effects is not null
  or e.dose_rate_effects is not null
  or e.displacement_damage is not null
  or e.other_effects is not null
  or e.quantitative_data is not null
  or e.functional_impact is not null
  or e.observed_phenomena is not null
)
order by r._source_file nulls last, r._source_row_number nulls last
limit %(limit)s
"""


def _params(comp: ComponentRecord, limit: int) -> dict[str, Any]:
    terms = [f"%{term}%" for term in _query_terms(comp)]
    manufacturer_terms = [f"%{comp.manufacturer}%"] if comp.manufacturer else []
    if not terms:
        terms = ["%__NO_MATCH__%"]
    if not manufacturer_terms:
        manufacturer_terms = ["%__NO_MATCH__%"]
    return {"terms": terms, "manufacturer_terms": manufacturer_terms, "limit": limit}


def _query_terms(comp: ComponentRecord) -> list[str]:
    values = [comp.model, comp.name]
    terms: list[str] = []
    for value in values:
        text = (value or "").strip()
        if text and text not in terms:
            terms.append(text)
        for token in re.findall(r"[A-Za-z][A-Za-z0-9/_+.\-]{2,}|[\u4e00-\u9fff]{2,}", text):
            if token not in terms:
                terms.append(token)
    return terms


def _summary(query_type: QueryType, rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    snippets = []
    for row in rows[:5]:
        if query_type == "quality":
            fields = [row.get("model"), row.get("component_type"), row.get("manufacturer"), row.get("issue_description")]
        else:
            fields = [
                row.get("model"),
                row.get("component_type"),
                row.get("radiation_source"),
                row.get("single_event_effects") or row.get("total_dose_effects") or row.get("functional_impact"),
            ]
        snippets.append("；".join(str(item) for item in fields if item))
    return "\n".join(snippets)


def _block(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "count": item.get("count", 0),
        "answer": item.get("summary", ""),
        "summary": item.get("summary", ""),
        "match_type": item.get("match_type", "未命中"),
        "match_level": item.get("match_level", item.get("match_type", "未命中")),
        "match_level_code": item.get("match_level_code", "miss"),
        "match_score": item.get("match_score", 0),
        "matched_terms": item.get("matched_terms", ""),
        "match_reason": item.get("match_reason", ""),
        "matched_models": item.get("matched_models", ""),
        "records": item.get("records", []),
    }


def _empty() -> dict[str, Any]:
    return {
        "count": 0,
        "answer": "",
        "summary": "",
        "match_type": "未命中",
        "match_level": "未命中",
        "match_level_code": "miss",
        "match_score": 0,
        "matched_terms": "",
        "match_reason": "未检索到数据库记录。",
        "matched_models": "",
        "records": [],
    }


def _combine(quality: list[dict[str, Any]], radiation: list[dict[str, Any]]) -> list[dict[str, Any]]:
    radiation_map = {(item.get("index"), item.get("model")): item for item in radiation}
    combined = []
    for quality_item in quality:
        key = (quality_item.get("index"), quality_item.get("model"))
        radiation_item = radiation_map.pop(key, None)
        combined.append(
            {
                "index": quality_item.get("index"),
                "component_name": quality_item.get("component_name"),
                "model": quality_item.get("model"),
                "manufacturer": quality_item.get("manufacturer"),
                "quality": _block(quality_item),
                "radiation": _block(radiation_item) if radiation_item else _empty(),
            }
        )
    for radiation_item in radiation_map.values():
        combined.append(
            {
                "index": radiation_item.get("index"),
                "component_name": radiation_item.get("component_name"),
                "model": radiation_item.get("model"),
                "manufacturer": radiation_item.get("manufacturer"),
                "quality": _empty(),
                "radiation": _block(radiation_item),
            }
        )
    return combined

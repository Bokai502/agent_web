from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ComponentRecord:
    index: int
    model: str = ""
    name: str = ""
    quality_level: str = ""
    package_type: str = ""
    working_temp: str = ""
    manufacturer: str = ""
    flight_history: str = ""
    is_low_quality: bool = False
    is_key_part: bool = False
    category_class: str = ""
    category_name: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PipelineContext:
    requirement_doc: Path
    component_list: Path
    output_dir: Path
    catalog_path: Path | None = None
    reliability_path: Path | None = None
    components: list[ComponentRecord] = field(default_factory=list)
    requirement_text: str = ""
    artifacts: dict[str, Any] = field(default_factory=dict)

    def set_artifact(self, name: str, value: Any) -> Any:
        self.artifacts[name] = value
        return value

    def get_artifact(self, name: str, default: Any = None) -> Any:
        return self.artifacts.get(name, default)

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Item:
    name: str
    width: float
    height: float
    depth: float
    weight: float = 0.0
    position: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])


@dataclass
class Bin:
    name: str
    width: float
    height: float
    depth: float
    max_weight: float = 0.0
    items: list[Item] = field(default_factory=list)
    unfitted_items: list[Item] = field(default_factory=list)

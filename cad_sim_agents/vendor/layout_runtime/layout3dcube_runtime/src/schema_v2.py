"""v2 数据结构定义

支持舱外安装 + 组件级接触热阻 + 多仓体 + 散热面。

核心对象:
- AABB (复用 v1)
- OrientedFace: 有方向的矩形面, 所有可装面/墙面/外壳面统一抽象
- OuterShell: 外壳 (faces_inner + faces_outer)
- Cabin: 真实分仓
- CabinWall: 有厚度薄板墙 (Q3 决定)
- Part: 带 kind (internal/external/radiator) + mount_face_id (字符串, 不再是 int)
- PlacementNode: 排布树节点 (kind ∈ cabin/virtual_split/leaf)
- SatelliteModelV2: 容器 (往返 YAML/JSON)

本文件只定义数据结构与 to_dict/from_dict, 不含算法。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
import numpy as np


# ============================================================
# 基础: AABB (v2 自带, 不从 v1 导入, 避免循环 / 让 v2 独立)
# ============================================================

@dataclass
class AABB:
    min: np.ndarray
    max: np.ndarray

    def __post_init__(self):
        if not isinstance(self.min, np.ndarray):
            self.min = np.array(self.min, dtype=float)
        if not isinstance(self.max, np.ndarray):
            self.max = np.array(self.max, dtype=float)

    def volume(self) -> float:
        size = self.max - self.min
        return float(np.prod(size))

    def center(self) -> np.ndarray:
        return (self.min + self.max) / 2.0

    def size(self) -> np.ndarray:
        return self.max - self.min

    def min_edge(self) -> float:
        return float(np.min(self.size()))

    def to_dict(self) -> Dict[str, List[float]]:
        return {"min": [float(v) for v in self.min], "max": [float(v) for v in self.max]}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AABB":
        return cls(min=np.array(d["min"], dtype=float), max=np.array(d["max"], dtype=float))


# ============================================================
# 面元: OrientedFace
# ============================================================

# face tag 在 cabin/shell 本地坐标下的标识
AXIS_NAMES = ("x", "y", "z")
FACE_TAGS = ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")  # 对应 v1 的 0..5


def face_tag_to_axis_sign(tag: str) -> Tuple[int, int]:
    """
    'xmin' -> (0, -1), 'xmax' -> (0, +1)
    'ymin' -> (1, -1), ...
    """
    assert tag in FACE_TAGS, f"invalid face tag: {tag}"
    axis = {"x": 0, "y": 1, "z": 2}[tag[0]]
    sign = +1 if tag.endswith("max") else -1
    return axis, sign


@dataclass
class OrientedFace:
    """一块有方向的矩形面。

    在 v1 中安装面隐含为 int 0..5 (相对 envelope.inner), v2 把它升成一等对象:
    - 有稳定 id (生成时确定)
    - 归属某个 cabin / outer_shell / wall
    - 记录实际 3D 坐标 (供 COMSOL 用坐标选面)
    - 记录 2D bbox 和 3D extents (供装箱和 debug)

    字段对应中间文档的 install_faces 注册表条目。
    """
    id: str                          # 稳定 tag, 如 "cabin_main.zmin", "outer.zmax_inner"
    belongs_to: str                  # "outer_shell" / cabin_id / wall_id
    side: str                        # "inner" / "outer" / "+normal" / "-normal"
    cabin_face_tag: str              # xmin/xmax/ymin/ymax/zmin/zmax (归属对象本地坐标)
    plane_axis: int                  # 0/1/2 (面法向所在轴)
    plane_value: float               # 面所在坐标值 (mm)
    normal_sign: int                 # +1 / -1 (外法向方向)
    bbox_2d: Tuple[float, float, float, float]   # (u_min, u_max, v_min, v_max) 面内 2D
    center_xyz: Tuple[float, float, float]       # 冗余 3D 中心, 便于 COMSOL lookup
    extents_xyz: Tuple[float, float, float]      # 面 bbox 的 3D 尺寸 (法向维度为 0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "belongs_to": self.belongs_to,
            "side": self.side,
            "cabin_face_tag": self.cabin_face_tag,
            "plane_axis": int(self.plane_axis),
            "plane_value": float(self.plane_value),
            "normal_sign": int(self.normal_sign),
            "bbox_2d": [float(v) for v in self.bbox_2d],
            "center_xyz": [float(v) for v in self.center_xyz],
            "extents_xyz": [float(v) for v in self.extents_xyz],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "OrientedFace":
        return cls(
            id=d["id"],
            belongs_to=d["belongs_to"],
            side=d["side"],
            cabin_face_tag=d["cabin_face_tag"],
            plane_axis=int(d["plane_axis"]),
            plane_value=float(d["plane_value"]),
            normal_sign=int(d["normal_sign"]),
            bbox_2d=tuple(float(v) for v in d["bbox_2d"]),
            center_xyz=tuple(float(v) for v in d["center_xyz"]),
            extents_xyz=tuple(float(v) for v in d["extents_xyz"]),
        )


# ============================================================
# OuterShell / Cabin / CabinWall
# ============================================================

@dataclass
class OuterShell:
    """外壳 (v1 Envelope 的升级)"""
    id: str
    outer_bbox: AABB                 # 最外轮廓
    inner_bbox: AABB                 # 内空 bbox (装舱内组件用; = outer - 2*thickness)
    thickness: float                 # 壳壁厚 (mm)
    faces_inner: List[OrientedFace] = field(default_factory=list)  # 6 内面
    faces_outer: List[OrientedFace] = field(default_factory=list)  # 6 外面
    material: Dict[str, Any] = field(default_factory=dict)         # density/thermal/...

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "outer_bbox": self.outer_bbox.to_dict(),
            "inner_bbox": self.inner_bbox.to_dict(),
            "thickness": float(self.thickness),
            "faces_inner": [f.to_dict() for f in self.faces_inner],
            "faces_outer": [f.to_dict() for f in self.faces_outer],
            "material": dict(self.material),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "OuterShell":
        return cls(
            id=d["id"],
            outer_bbox=AABB.from_dict(d["outer_bbox"]),
            inner_bbox=AABB.from_dict(d["inner_bbox"]),
            thickness=float(d["thickness"]),
            faces_inner=[OrientedFace.from_dict(f) for f in d.get("faces_inner", [])],
            faces_outer=[OrientedFace.from_dict(f) for f in d.get("faces_outer", [])],
            material=dict(d.get("material", {})),
        )


@dataclass
class Cabin:
    """真实分仓 (物理仓室)

    inner_bbox 是已扣除墙厚、直接可以装箱的空间。
    faces 是 6 张内表面, 装箱时与 outer_shell.faces_inner 并列作为候选安装面。
    """
    id: str
    inner_bbox: AABB
    parent: Optional[str] = None     # 父 cabin id (嵌套仓, 本阶段不用)
    faces: List[OrientedFace] = field(default_factory=list)    # 6 张内面
    material: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "inner_bbox": self.inner_bbox.to_dict(),
            "parent": self.parent,
            "faces": [f.to_dict() for f in self.faces],
            "material": dict(self.material),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Cabin":
        return cls(
            id=d["id"],
            inner_bbox=AABB.from_dict(d["inner_bbox"]),
            parent=d.get("parent"),
            faces=[OrientedFace.from_dict(f) for f in d.get("faces", [])],
            material=dict(d.get("material", {})),
        )


@dataclass
class CabinWall:
    """相邻 cabin 之间 / cabin-outer 之间的墙 (Q3: 有厚度薄板实体)

    墙自身是一个 3D solid, 有 bbox 和 thickness (沿法向维度):
    - face_on_a / face_on_b 分别指向墙在 A/B 两侧的可装面
    - between = (cabin_a_id, cabin_b_id); 特殊 id "outer_shell" 表示墙外侧接外壳
    """
    id: str
    between: Tuple[str, str]
    bbox: AABB                        # 墙体 AABB (3D, 法向维度 = thickness)
    normal_axis: int                  # 0/1/2 墙法向所在轴
    thickness: float                  # > 0: 有厚度薄板; = 0: 零厚度片体 (复用 outer 壳面)
    face_on_a: OrientedFace           # 墙在 A 侧的外法向面
    face_on_b: OrientedFace           # 墙在 B 侧的外法向面
    material: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "between": list(self.between),
            "bbox": self.bbox.to_dict(),
            "normal_axis": int(self.normal_axis),
            "thickness": float(self.thickness),
            "face_on_a": self.face_on_a.to_dict(),
            "face_on_b": self.face_on_b.to_dict(),
            "material": dict(self.material),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CabinWall":
        bt = d["between"]
        return cls(
            id=d["id"],
            between=(bt[0], bt[1]),
            bbox=AABB.from_dict(d["bbox"]),
            normal_axis=int(d["normal_axis"]),
            thickness=float(d["thickness"]),
            face_on_a=OrientedFace.from_dict(d["face_on_a"]),
            face_on_b=OrientedFace.from_dict(d["face_on_b"]),
            material=dict(d.get("material", {})),
        )


# ============================================================
# Part (v2)
# ============================================================

PART_KINDS = ("internal", "external", "radiator")


@dataclass
class PartV2:
    """组件 (v2)

    - kind 决定装在哪种面上:
      * internal → cabin.faces 或 outer_shell.faces_inner
      * external → outer_shell.faces_outer (普通 solid)
      * radiator → outer_shell.faces_outer (薄片, 高 emissivity)
    - mount_face_id 是 OrientedFace.id (字符串), 取代 v1 的 int 0..5
    - thermal_surface / thermal_interface 从全局 fallback 上升到 per-component
    """
    id: str                          # P_000_internal / E_001_external / R_002_radiator
    kind: str                        # internal/external/radiator
    category: str                    # payload/avionics/power/thermal/sensor/...
    dims: Tuple[float, float, float] # (x,y,z) 实际尺寸 mm
    mass: float
    power: float
    color: Tuple[int, int, int, int]
    clearance_mm: float = 0.0

    # 放置态
    mount_face_id: Optional[str] = None       # 绑定到 OrientedFace.id
    position: Optional[np.ndarray] = None     # 实际最小角坐标 (已扣除间隙语义)
    install_pos: Optional[np.ndarray] = None  # 装箱器产出的"安装坐标"(含间隙, debug 用)
    mount_point: Optional[np.ndarray] = None  # 安装面上的接触中心
    leaf_node_id: Optional[str] = None        # 放到了哪个 placement_tree leaf

    # 热参数 (per-component)
    thermal_surface: Dict[str, Any] = field(default_factory=dict)
    thermal_interface: Dict[str, Any] = field(default_factory=dict)
    thermoelastic: Dict[str, Any] = field(default_factory=dict)

    # 形状信息
    shape: str = "box"
    model: str = ""

    def __post_init__(self):
        assert self.kind in PART_KINDS, f"invalid kind: {self.kind}"
        if self.position is not None and not isinstance(self.position, np.ndarray):
            self.position = np.array(self.position, dtype=float)
        if self.install_pos is not None and not isinstance(self.install_pos, np.ndarray):
            self.install_pos = np.array(self.install_pos, dtype=float)
        if self.mount_point is not None and not isinstance(self.mount_point, np.ndarray):
            self.mount_point = np.array(self.mount_point, dtype=float)

    def get_actual_dims(self) -> np.ndarray:
        return np.array(self.dims, dtype=float)

    def to_dict(self) -> Dict[str, Any]:
        def _ndarr(x):
            return None if x is None else [float(v) for v in x]

        bbox = None
        if self.position is not None:
            dims = self.get_actual_dims()
            bbox = {
                "min": [float(v) for v in self.position],
                "max": [float(v) for v in (self.position + dims)],
            }

        return {
            "id": self.id,
            "kind": self.kind,
            "category": self.category,
            "dims": [float(v) for v in self.dims],
            "mass": float(self.mass),
            "power": float(self.power),
            "color": [int(v) for v in self.color],
            "clearance_mm": float(self.clearance_mm),
            "shape": self.shape,
            "model": self.model,
            "mount_face_id": self.mount_face_id,
            "position": _ndarr(self.position),
            "install_pos": _ndarr(self.install_pos),
            "mount_point": _ndarr(self.mount_point),
            "bbox": bbox,
            "leaf_node_id": self.leaf_node_id,
            "thermal_surface": dict(self.thermal_surface),
            "thermal_interface": dict(self.thermal_interface),
            "thermoelastic": dict(self.thermoelastic),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PartV2":
        def _ndarr(x):
            return None if x is None else np.array(x, dtype=float)

        return cls(
            id=d["id"],
            kind=d["kind"],
            category=d.get("category", "unknown"),
            dims=tuple(float(v) for v in d["dims"]),
            mass=float(d["mass"]),
            power=float(d["power"]),
            color=tuple(int(v) for v in d.get("color", (128, 128, 128, 255))),
            clearance_mm=float(d.get("clearance_mm", 0.0)),
            shape=d.get("shape", "box"),
            model=d.get("model", ""),
            mount_face_id=d.get("mount_face_id"),
            position=_ndarr(d.get("position")),
            install_pos=_ndarr(d.get("install_pos")),
            mount_point=_ndarr(d.get("mount_point")),
            leaf_node_id=d.get("leaf_node_id"),
            thermal_surface=dict(d.get("thermal_surface", {})),
            thermal_interface=dict(d.get("thermal_interface", {})),
            thermoelastic=dict(d.get("thermoelastic", {})),
        )


# ============================================================
# PlacementNode
# ============================================================

NODE_KINDS = ("cabin", "virtual_split", "leaf")


@dataclass
class PlacementNode:
    id: str
    kind: str                        # cabin/virtual_split/leaf
    bbox: AABB
    parent: Optional[str] = None
    children: List[str] = field(default_factory=list)

    # kind == cabin
    cabin_id: Optional[str] = None

    # kind == virtual_split
    split_axis: Optional[int] = None
    split_at: Optional[float] = None

    # kind == leaf
    mount_face_ids: List[str] = field(default_factory=list)
    parts: List[str] = field(default_factory=list)

    def __post_init__(self):
        assert self.kind in NODE_KINDS, f"invalid node kind: {self.kind}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "bbox": self.bbox.to_dict(),
            "parent": self.parent,
            "children": list(self.children),
            "cabin_id": self.cabin_id,
            "split_axis": self.split_axis,
            "split_at": self.split_at,
            "mount_face_ids": list(self.mount_face_ids),
            "parts": list(self.parts),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PlacementNode":
        return cls(
            id=d["id"],
            kind=d["kind"],
            bbox=AABB.from_dict(d["bbox"]),
            parent=d.get("parent"),
            children=list(d.get("children", [])),
            cabin_id=d.get("cabin_id"),
            split_axis=d.get("split_axis"),
            split_at=d.get("split_at"),
            mount_face_ids=list(d.get("mount_face_ids", [])),
            parts=list(d.get("parts", [])),
        )


# ============================================================
# SatelliteModelV2 (顶层容器)
# ============================================================

SCHEMA_VERSION = "2.0"


@dataclass
class SatelliteModelV2:
    outer_shell: OuterShell
    cabins: List[Cabin] = field(default_factory=list)
    cabin_walls: List[CabinWall] = field(default_factory=list)
    placement_tree: List[PlacementNode] = field(default_factory=list)
    parts: List[PartV2] = field(default_factory=list)

    # install_faces_by_id: 全局注册表, id → OrientedFace
    # 重要: 同一个 face 可能被多个拥有者引用 (例如 wall 的两面各属不同 cabin)
    # 但 id 全局唯一
    install_faces: Dict[str, OrientedFace] = field(default_factory=dict)

    # 元信息
    units: Dict[str, str] = field(default_factory=dict)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "units": dict(self.units),
            "meta": dict(self.meta),
            "outer_shell": self.outer_shell.to_dict(),
            "cabins": [c.to_dict() for c in self.cabins],
            "cabin_walls": [w.to_dict() for w in self.cabin_walls],
            "placement_tree": [n.to_dict() for n in self.placement_tree],
            "parts": [p.to_dict() for p in self.parts],
            "install_faces": {fid: f.to_dict() for fid, f in self.install_faces.items()},
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SatelliteModelV2":
        sv = d.get("schema_version", "?")
        if str(sv) != SCHEMA_VERSION:
            raise ValueError(
                f"schema_version mismatch: expected {SCHEMA_VERSION}, got {sv}"
            )
        return cls(
            outer_shell=OuterShell.from_dict(d["outer_shell"]),
            cabins=[Cabin.from_dict(x) for x in d.get("cabins", [])],
            cabin_walls=[CabinWall.from_dict(x) for x in d.get("cabin_walls", [])],
            placement_tree=[PlacementNode.from_dict(x) for x in d.get("placement_tree", [])],
            parts=[PartV2.from_dict(x) for x in d.get("parts", [])],
            install_faces={
                fid: OrientedFace.from_dict(f)
                for fid, f in d.get("install_faces", {}).items()
            },
            units=dict(d.get("units", {})),
            meta=dict(d.get("meta", {})),
        )

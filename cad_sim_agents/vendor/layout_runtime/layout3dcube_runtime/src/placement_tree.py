"""Placement tree builder + real cabin wall generation (v2).

对照 v1 的 ``keepout_split.build_bins``:
- v1: 从 envelope.inner 切 keepouts, 返回 List[AABB] "bins", 全部语义相同
- v2: 产出 OuterShell + List[Cabin] + List[CabinWall] (有厚度薄板) + PlacementNode 树
  + install_faces 注册表, 每个对象有独立语义

当前支持的 cabins_layout:
  - type: "single"         → 单仓, 等价 v1 单 bin
  - type: "axial_split"    → 沿某轴一刀两半, 产生 2 cabin + 1 wall
  - type: "auto"           → v2 口径下复用 keep-out 子容器逻辑生成真实 cabin
  - type: "count"          → 按 count/num_cabins/n_cabins 指定 1~4 个 cabin
  - type: "explicit_bboxes" → 显式给出 cabin bbox

扩展点 (留给后续):
  - 自动推断 wall
  - cabin 嵌套 (cabin parent)
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import numpy as np

from src.schema_v2 import (
    AABB,
    OrientedFace,
    OuterShell,
    Cabin,
    CabinWall,
    PlacementNode,
    SatelliteModelV2,
    FACE_TAGS,
    face_tag_to_axis_sign,
)


MAX_CABINS = 4
DEFAULT_SURFACE_RATIO_THRESHOLD = 0.25


# ============================================================
# 工具
# ============================================================

def _axis_char_to_int(ax) -> int:
    """'x'/'y'/'z' → 0/1/2; 或 int 原样返回"""
    if isinstance(ax, int):
        assert ax in (0, 1, 2)
        return ax
    m = {"x": 0, "y": 1, "z": 2, "X": 0, "Y": 1, "Z": 2}
    return m[ax]


def _bbox_face(
    bbox: AABB, face_tag: str,
) -> Tuple[int, int, float, Tuple[float, float, float, float], Tuple[float, float, float], Tuple[float, float, float]]:
    """给定一个 AABB 和面 tag (xmin/xmax/...), 返回
    (plane_axis, normal_sign, plane_value, bbox_2d, center_xyz, extents_xyz).
    """
    axis, sign = face_tag_to_axis_sign(face_tag)
    if sign < 0:
        plane_value = float(bbox.min[axis])
    else:
        plane_value = float(bbox.max[axis])

    other_axes = [a for a in (0, 1, 2) if a != axis]
    u_ax, v_ax = other_axes[0], other_axes[1]
    u_min, u_max = float(bbox.min[u_ax]), float(bbox.max[u_ax])
    v_min, v_max = float(bbox.min[v_ax]), float(bbox.max[v_ax])

    center = [0.0, 0.0, 0.0]
    center[axis] = plane_value
    center[u_ax] = (u_min + u_max) / 2.0
    center[v_ax] = (v_min + v_max) / 2.0

    extents = [0.0, 0.0, 0.0]
    extents[u_ax] = u_max - u_min
    extents[v_ax] = v_max - v_min
    # 法向维度 extent = 0 (面不含厚度)

    return axis, sign, plane_value, (u_min, u_max, v_min, v_max), tuple(center), tuple(extents)


def _make_face_for_bbox(
    face_id: str,
    belongs_to: str,
    side: str,
    bbox: AABB,
    face_tag: str,
) -> OrientedFace:
    axis, sign, plane_value, bbox_2d, center_xyz, extents_xyz = _bbox_face(bbox, face_tag)
    return OrientedFace(
        id=face_id,
        belongs_to=belongs_to,
        side=side,
        cabin_face_tag=face_tag,
        plane_axis=axis,
        plane_value=plane_value,
        normal_sign=sign,
        bbox_2d=bbox_2d,
        center_xyz=center_xyz,
        extents_xyz=extents_xyz,
    )


def _gen_outer_shell(
    outer_size: Tuple[float, float, float],
    thickness: float,
    origin: str = "center",
    material: Optional[Dict] = None,
) -> OuterShell:
    sx, sy, sz = outer_size
    size = np.array([sx, sy, sz], dtype=float)

    if origin == "center":
        outer_min = -size / 2.0
        outer_max = size / 2.0
    else:
        outer_min = np.array([0.0, 0.0, 0.0])
        outer_max = size

    outer_bbox = AABB(min=outer_min, max=outer_max)
    if thickness > 0:
        inner_bbox = AABB(
            min=outer_min + thickness,
            max=outer_max - thickness,
        )
    else:
        inner_bbox = AABB(min=outer_min.copy(), max=outer_max.copy())

    # 6 inner faces (面 id = "outer.<tag>_inner"; side="inner"; belongs_to="outer_shell")
    faces_inner: List[OrientedFace] = []
    for tag in FACE_TAGS:
        axis, sign = face_tag_to_axis_sign(tag)
        # inner 面的 normal_sign 指向舱内 (与 outer 方向相反)
        _, _, plane_value, bbox_2d, center_xyz, extents_xyz = _bbox_face(inner_bbox, tag)
        faces_inner.append(OrientedFace(
            id=f"outer.{tag}_inner",
            belongs_to="outer_shell",
            side="inner",
            cabin_face_tag=tag,
            plane_axis=axis,
            plane_value=plane_value,
            normal_sign=-sign,   # 从 outer 往 inner 看: 法向反过来
            bbox_2d=bbox_2d,
            center_xyz=center_xyz,
            extents_xyz=extents_xyz,
        ))

    # 6 outer faces (side="outer", 法向对外)
    faces_outer: List[OrientedFace] = []
    for tag in FACE_TAGS:
        axis, sign = face_tag_to_axis_sign(tag)
        _, _, plane_value, bbox_2d, center_xyz, extents_xyz = _bbox_face(outer_bbox, tag)
        faces_outer.append(OrientedFace(
            id=f"outer.{tag}_outer",
            belongs_to="outer_shell",
            side="outer",
            cabin_face_tag=tag,
            plane_axis=axis,
            plane_value=plane_value,
            normal_sign=sign,
            bbox_2d=bbox_2d,
            center_xyz=center_xyz,
            extents_xyz=extents_xyz,
        ))

    return OuterShell(
        id="outer_shell",
        outer_bbox=outer_bbox,
        inner_bbox=inner_bbox,
        thickness=float(thickness),
        faces_inner=faces_inner,
        faces_outer=faces_outer,
        material=dict(material or {}),
    )


def _gen_cabin_faces(cabin_id: str, inner_bbox: AABB) -> List[OrientedFace]:
    """为 cabin 生成 6 张内面 (从 cabin 内部往外看)"""
    faces = []
    for tag in FACE_TAGS:
        f = _make_face_for_bbox(
            face_id=f"cabin_{cabin_id}.{tag}" if not cabin_id.startswith("cabin_") else f"{cabin_id}.{tag}",
            belongs_to=cabin_id,
            side="inner",
            bbox=inner_bbox,
            face_tag=tag,
        )
        faces.append(f)
    return faces


def _surface_area(bbox: AABB) -> float:
    dx, dy, dz = [float(v) for v in bbox.size()]
    if dx <= 0 or dy <= 0 or dz <= 0:
        return 0.0
    return 2.0 * (dx * dy + dx * dz + dy * dz)


def _boxes_overlap(a: AABB, b: AABB) -> bool:
    return bool(
        a.min[0] < b.max[0] and a.max[0] > b.min[0]
        and a.min[1] < b.max[1] and a.max[1] > b.min[1]
        and a.min[2] < b.max[2] and a.max[2] > b.min[2]
    )


def _intersect_box(a: AABB, b: AABB) -> AABB:
    return AABB(min=np.maximum(a.min, b.min), max=np.minimum(a.max, b.max))


def _subtract_box(a: AABB, b: AABB) -> List[AABB]:
    """v2 AABB 盒差: 从 a 中扣掉 b, 最多产生 6 个子容器."""
    if not _boxes_overlap(a, b):
        return [a]

    i = _intersect_box(a, b)
    pieces: List[AABB] = []

    if a.min[0] < i.min[0]:
        pieces.append(AABB(
            min=np.array([a.min[0], a.min[1], a.min[2]], dtype=float),
            max=np.array([i.min[0], a.max[1], a.max[2]], dtype=float),
        ))
    if i.max[0] < a.max[0]:
        pieces.append(AABB(
            min=np.array([i.max[0], a.min[1], a.min[2]], dtype=float),
            max=np.array([a.max[0], a.max[1], a.max[2]], dtype=float),
        ))

    if a.min[1] < i.min[1]:
        pieces.append(AABB(
            min=np.array([i.min[0], a.min[1], a.min[2]], dtype=float),
            max=np.array([i.max[0], i.min[1], a.max[2]], dtype=float),
        ))
    if i.max[1] < a.max[1]:
        pieces.append(AABB(
            min=np.array([i.min[0], i.max[1], a.min[2]], dtype=float),
            max=np.array([i.max[0], a.max[1], a.max[2]], dtype=float),
        ))

    if a.min[2] < i.min[2]:
        pieces.append(AABB(
            min=np.array([i.min[0], i.min[1], a.min[2]], dtype=float),
            max=np.array([i.max[0], i.max[1], i.min[2]], dtype=float),
        ))
    if i.max[2] < a.max[2]:
        pieces.append(AABB(
            min=np.array([i.min[0], i.min[1], i.max[2]], dtype=float),
            max=np.array([i.max[0], i.max[1], a.max[2]], dtype=float),
        ))

    return [p for p in pieces if p.volume() > 1e-6 and p.min_edge() > 1e-6]


def _parse_keepouts(cfg: Dict) -> List[AABB]:
    raw_keepouts = cfg.get("keepouts", cfg.get("keep_out", [])) or []
    keepouts: List[AABB] = []
    for ko in raw_keepouts:
        if "min_mm" in ko and "max_mm" in ko:
            keepouts.append(AABB(
                min=np.array(ko["min_mm"], dtype=float),
                max=np.array(ko["max_mm"], dtype=float),
            ))
        elif "min" in ko and "max" in ko:
            keepouts.append(AABB(
                min=np.array(ko["min"], dtype=float),
                max=np.array(ko["max"], dtype=float),
            ))
    return keepouts


def _build_subcontainers(inner_bbox: AABB, keepouts: List[AABB], min_edge_threshold: float) -> List[AABB]:
    bins = [AABB(min=inner_bbox.min.copy(), max=inner_bbox.max.copy())]
    for ko in keepouts:
        new_bins: List[AABB] = []
        for b in bins:
            new_bins.extend(_subtract_box(b, ko))
        bins = new_bins
    return [b for b in bins if b.min_edge() >= min_edge_threshold]


def _requested_cabin_count(cfg: Dict) -> Optional[int]:
    for key in ("count", "num_cabins", "n_cabins", "cabin_count"):
        if cfg.get(key) is not None:
            count = int(cfg[key])
            if count < 1 or count > MAX_CABINS:
                raise ValueError(f"cabins_layout.{key} must be in [1, {MAX_CABINS}], got {count}")
            return count
    return None


def _split_bbox_equal(bbox: AABB, count: int) -> List[AABB]:
    """在没有 keep-out 子容器时, 按内部 bbox 确定性切出 1~4 个舱."""
    if count == 1:
        return [AABB(min=bbox.min.copy(), max=bbox.max.copy())]

    size = bbox.size()
    axes_by_size = list(np.argsort(size)[::-1])

    if count in (2, 3):
        axis = int(axes_by_size[0])
        cuts = np.linspace(float(bbox.min[axis]), float(bbox.max[axis]), count + 1)
        bboxes: List[AABB] = []
        for i in range(count):
            mn = bbox.min.copy()
            mx = bbox.max.copy()
            mn[axis] = cuts[i]
            mx[axis] = cuts[i + 1]
            bboxes.append(AABB(min=mn, max=mx))
        return bboxes

    # count == 4: 在两个最长轴上做 2x2 网格, 避免单轴切成过薄长条.
    ax0, ax1 = int(axes_by_size[0]), int(axes_by_size[1])
    mid0 = (float(bbox.min[ax0]) + float(bbox.max[ax0])) / 2.0
    mid1 = (float(bbox.min[ax1]) + float(bbox.max[ax1])) / 2.0
    bboxes = []
    for lo0, hi0 in ((bbox.min[ax0], mid0), (mid0, bbox.max[ax0])):
        for lo1, hi1 in ((bbox.min[ax1], mid1), (mid1, bbox.max[ax1])):
            mn = bbox.min.copy()
            mx = bbox.max.copy()
            mn[ax0], mx[ax0] = lo0, hi0
            mn[ax1], mx[ax1] = lo1, hi1
            bboxes.append(AABB(min=mn, max=mx))
    return bboxes


def _make_cabins_from_bboxes(
    bboxes: List[AABB],
    cfg: Dict,
    id_prefix: str = "cabin",
) -> Tuple[List[Cabin], List[PlacementNode]]:
    cabin_ids = list(cfg.get("cabin_ids", []))
    material = cfg.get("cabin_material", {})
    cabins: List[Cabin] = []
    nodes: List[PlacementNode] = []

    root_id = "node.root"
    if len(bboxes) > 1:
        root_bbox = AABB(
            min=np.minimum.reduce([b.min for b in bboxes]),
            max=np.maximum.reduce([b.max for b in bboxes]),
        )
        nodes.append(PlacementNode(
            id=root_id,
            kind="virtual_split",
            bbox=root_bbox,
            parent=None,
            children=[],
        ))
        parent_id: Optional[str] = root_id
    else:
        parent_id = None

    for idx, bbox in enumerate(bboxes):
        cabin_id = str(cabin_ids[idx]) if idx < len(cabin_ids) else f"{id_prefix}_{idx + 1}"
        cabin = Cabin(
            id=cabin_id,
            inner_bbox=AABB(min=bbox.min.copy(), max=bbox.max.copy()),
            parent=None,
            faces=_gen_cabin_faces(cabin_id, bbox),
            material=dict(material),
        )
        cabins.append(cabin)

        cab_node_id = f"node.{cabin_id}"
        leaf_id = f"leaf.{cabin_id}"
        nodes.append(PlacementNode(
            id=cab_node_id,
            kind="cabin",
            bbox=AABB(min=bbox.min.copy(), max=bbox.max.copy()),
            parent=parent_id,
            children=[leaf_id],
            cabin_id=cabin_id,
        ))
        nodes.append(PlacementNode(
            id=leaf_id,
            kind="leaf",
            bbox=AABB(min=bbox.min.copy(), max=bbox.max.copy()),
            parent=cab_node_id,
            children=[],
            mount_face_ids=[f.id for f in cabin.faces],
        ))
        if parent_id == root_id:
            nodes[0].children.append(cab_node_id)

    return cabins, nodes


def _select_subcontainer_cabins(
    inner_bbox: AABB,
    cfg: Dict,
) -> List[AABB]:
    keepouts = _parse_keepouts(cfg)
    min_edge_threshold = float(cfg.get("min_edge_threshold", 5.0))
    bins = _build_subcontainers(inner_bbox, keepouts, min_edge_threshold)
    if not bins:
        bins = [AABB(min=inner_bbox.min.copy(), max=inner_bbox.max.copy())]

    requested_count = _requested_cabin_count(cfg)
    inner_area = max(_surface_area(inner_bbox), 1e-9)

    if requested_count is not None:
        if len(bins) >= requested_count:
            ranked = sorted(
                bins,
                key=lambda b: (_surface_area(b) / inner_area, b.volume()),
                reverse=True,
            )
            return ranked[:requested_count]
        return _split_bbox_equal(inner_bbox, requested_count)

    threshold = float(cfg.get("surface_area_ratio_threshold", DEFAULT_SURFACE_RATIO_THRESHOLD))
    candidates = [
        b for b in bins
        if (_surface_area(b) / inner_area) >= threshold
    ]
    if not candidates:
        candidates = [max(bins, key=lambda b: b.volume())]

    candidates = sorted(
        candidates,
        key=lambda b: (_surface_area(b) / inner_area, b.volume()),
        reverse=True,
    )
    return candidates[:MAX_CABINS]


# ============================================================
# 主入口
# ============================================================

def build_placement_tree(
    outer_size: Tuple[float, float, float],
    shell_thickness: float,
    cabins_layout: Dict,
    shell_material: Optional[Dict] = None,
    origin: str = "center",
) -> SatelliteModelV2:
    """根据配置生成完整的几何-语义骨架 (无 parts).

    Args:
        outer_size: (sx, sy, sz) mm
        shell_thickness: 外壳厚度 mm
        cabins_layout: 分仓配置; type ∈ {"single", "axial_split", "auto", "count", "explicit_bboxes"}
        shell_material: 外壳材料 dict (optional)
        origin: "center" 或 "corner"

    Returns:
        SatelliteModelV2 (parts 为空, placement_tree/cabins/walls/install_faces 就位)
    """
    outer_shell = _gen_outer_shell(
        outer_size=outer_size,
        thickness=shell_thickness,
        origin=origin,
        material=shell_material,
    )

    layout_type = cabins_layout.get("type", "auto")

    if layout_type == "single":
        cabins, walls, tree = _build_single_cabin(outer_shell, cabins_layout)
    elif layout_type == "axial_split":
        cabins, walls, tree = _build_axial_split(outer_shell, cabins_layout)
    elif layout_type in ("auto", "auto_subcontainers", "subcontainers"):
        cabins, walls, tree = _build_auto_cabins(outer_shell, cabins_layout)
    elif layout_type in ("count", "count_split"):
        cabins, walls, tree = _build_count_split(outer_shell, cabins_layout)
    elif layout_type == "explicit_bboxes":
        cabins, walls, tree = _build_explicit_bboxes(outer_shell, cabins_layout)
    else:
        raise ValueError(f"unsupported cabins_layout.type: {layout_type}")

    # 建 install_faces 注册表 (全局 id 唯一)
    install_faces: Dict[str, OrientedFace] = {}
    for f in outer_shell.faces_inner + outer_shell.faces_outer:
        install_faces[f.id] = f
    for c in cabins:
        for f in c.faces:
            install_faces[f.id] = f
    for w in walls:
        install_faces[w.face_on_a.id] = w.face_on_a
        install_faces[w.face_on_b.id] = w.face_on_b

    return SatelliteModelV2(
        outer_shell=outer_shell,
        cabins=cabins,
        cabin_walls=walls,
        placement_tree=tree,
        parts=[],
        install_faces=install_faces,
    )


# ============================================================
# 场景 0: 自动 / 指定数量 / 显式 bbox 分仓
# ============================================================

def _build_auto_cabins(
    outer_shell: OuterShell,
    cfg: Dict,
) -> Tuple[List[Cabin], List[CabinWall], List[PlacementNode]]:
    """v2 自动分仓.

    未指定舱室数量时, 先用 keep-out 对 outer.inner_bbox 做子容器切分;
    子容器可安装表面积 / 整体内部表面积 达到阈值时升级为真实 cabin.
    指定 count/num_cabins/n_cabins 时, 仍优先选子容器; 子容器不足则对内部空间做确定性等分。
    """
    selected = _select_subcontainer_cabins(outer_shell.inner_bbox, cfg)
    cabins, tree = _make_cabins_from_bboxes(selected, cfg, id_prefix=cfg.get("cabin_id_prefix", "cabin_auto"))
    return cabins, [], tree


def _build_count_split(
    outer_shell: OuterShell,
    cfg: Dict,
) -> Tuple[List[Cabin], List[CabinWall], List[PlacementNode]]:
    count = _requested_cabin_count(cfg)
    if count is None:
        raise ValueError("cabins_layout.type=count requires count/num_cabins/n_cabins")
    bboxes = _split_bbox_equal(outer_shell.inner_bbox, count)
    cabins, tree = _make_cabins_from_bboxes(bboxes, cfg, id_prefix=cfg.get("cabin_id_prefix", "cabin"))
    return cabins, [], tree


def _build_explicit_bboxes(
    outer_shell: OuterShell,
    cfg: Dict,
) -> Tuple[List[Cabin], List[CabinWall], List[PlacementNode]]:
    raw_bboxes = cfg.get("bboxes", cfg.get("cabins", [])) or []
    if not raw_bboxes:
        raise ValueError("cabins_layout.type=explicit_bboxes requires bboxes/cabins")
    if len(raw_bboxes) > MAX_CABINS:
        raise ValueError(f"cabins_layout explicit bboxes cannot exceed {MAX_CABINS}")

    bboxes: List[AABB] = []
    ids: List[str] = []
    for idx, item in enumerate(raw_bboxes):
        if "bbox" in item:
            item = {**item, **item["bbox"]}
        if "id" in item:
            ids.append(str(item["id"]))
        if "min_mm" in item and "max_mm" in item:
            mn, mx = item["min_mm"], item["max_mm"]
        elif "min" in item and "max" in item:
            mn, mx = item["min"], item["max"]
        else:
            raise ValueError(f"explicit cabin bbox #{idx} missing min/max")
        bbox = AABB(min=np.array(mn, dtype=float), max=np.array(mx, dtype=float))
        if np.any(bbox.min < outer_shell.inner_bbox.min - 1e-6) or np.any(bbox.max > outer_shell.inner_bbox.max + 1e-6):
            raise ValueError(f"explicit cabin bbox #{idx} outside outer inner bbox")
        bboxes.append(bbox)

    cfg_with_ids = dict(cfg)
    if ids and "cabin_ids" not in cfg_with_ids:
        cfg_with_ids["cabin_ids"] = ids
    cabins, tree = _make_cabins_from_bboxes(bboxes, cfg_with_ids, id_prefix=cfg.get("cabin_id_prefix", "cabin_explicit"))
    return cabins, [], tree


# ============================================================
# 场景 1: 单仓
# ============================================================

def _build_single_cabin(
    outer_shell: OuterShell,
    cfg: Dict,
) -> Tuple[List[Cabin], List[CabinWall], List[PlacementNode]]:
    cabin_id = cfg.get("cabin_id", "cabin_main")
    material = cfg.get("cabin_material", {})

    # 单仓: inner_bbox 直接复用 outer.inner_bbox
    cabin = Cabin(
        id=cabin_id,
        inner_bbox=AABB(min=outer_shell.inner_bbox.min.copy(), max=outer_shell.inner_bbox.max.copy()),
        parent=None,
        faces=_gen_cabin_faces(cabin_id, outer_shell.inner_bbox),
        material=dict(material),
    )

    node = PlacementNode(
        id=f"node.{cabin_id}",
        kind="cabin",
        bbox=AABB(min=cabin.inner_bbox.min.copy(), max=cabin.inner_bbox.max.copy()),
        parent=None,
        children=[f"leaf.{cabin_id}"],
        cabin_id=cabin_id,
    )
    leaf = PlacementNode(
        id=f"leaf.{cabin_id}",
        kind="leaf",
        bbox=AABB(min=cabin.inner_bbox.min.copy(), max=cabin.inner_bbox.max.copy()),
        parent=node.id,
        children=[],
        mount_face_ids=[f.id for f in cabin.faces],
    )
    return [cabin], [], [node, leaf]


# ============================================================
# 场景 2: 轴向分仓 (一刀两半 + 薄板墙)
# ============================================================

def _build_axial_split(
    outer_shell: OuterShell,
    cfg: Dict,
) -> Tuple[List[Cabin], List[CabinWall], List[PlacementNode]]:
    """沿 axis 在 at 切一刀, 生成 2 cabin + 1 wall (有厚度薄板)

    cfg 必需字段:
      axis: "x"/"y"/"z" 或 0/1/2
      at: float (绝对坐标)
      wall_thickness: float (>0)
      cabin_plus_id: str
      cabin_minus_id: str
      share: [float, float] 默认 [0.5, 0.5], 墙厚给 + 侧和 - 侧的分配比

    wall_thickness <=0 时当 0 处理 (零厚度墙不产生 solid, 只产生共用面)
    """
    axis = _axis_char_to_int(cfg["axis"])
    at = float(cfg["at"])
    wall_t = float(cfg.get("wall_thickness", 0.0))
    share = cfg.get("share", [0.5, 0.5])
    share_plus = float(share[0])
    share_minus = float(share[1])
    assert abs(share_plus + share_minus - 1.0) < 1e-6, "share must sum to 1.0"

    cabin_plus_id = cfg.get("cabin_plus_id", "cabin_plus")
    cabin_minus_id = cfg.get("cabin_minus_id", "cabin_minus")
    cabin_plus_mat = cfg.get("cabin_plus_material", {})
    cabin_minus_mat = cfg.get("cabin_minus_material", {})
    wall_mat = cfg.get("wall_material", {})

    # 两侧 cabin 的 inner_bbox: 从 outer.inner_bbox 切一刀, 扣除自己分到的墙厚
    inner = outer_shell.inner_bbox
    inner_min = inner.min.copy()
    inner_max = inner.max.copy()

    assert inner_min[axis] < at < inner_max[axis], \
        f"axial split at={at} not inside inner bbox {inner_min[axis]}-{inner_max[axis]}"

    # + 侧: axis 坐标 > at
    plus_min = inner_min.copy()
    plus_max = inner_max.copy()
    plus_min[axis] = at + wall_t * share_plus
    cabin_plus_bbox = AABB(min=plus_min, max=plus_max)

    # - 侧: axis 坐标 < at
    minus_min = inner_min.copy()
    minus_max = inner_max.copy()
    minus_max[axis] = at - wall_t * share_minus
    cabin_minus_bbox = AABB(min=minus_min, max=minus_max)

    assert cabin_plus_bbox.volume() > 0, "cabin_plus has no volume"
    assert cabin_minus_bbox.volume() > 0, "cabin_minus has no volume"

    cabin_plus = Cabin(
        id=cabin_plus_id,
        inner_bbox=cabin_plus_bbox,
        faces=_gen_cabin_faces(cabin_plus_id, cabin_plus_bbox),
        material=dict(cabin_plus_mat),
    )
    cabin_minus = Cabin(
        id=cabin_minus_id,
        inner_bbox=cabin_minus_bbox,
        faces=_gen_cabin_faces(cabin_minus_id, cabin_minus_bbox),
        material=dict(cabin_minus_mat),
    )

    # 墙: 占据 [at - wall_t*share_minus, at + wall_t*share_plus] 区间
    if wall_t > 0:
        wall_min = inner_min.copy()
        wall_max = inner_max.copy()
        wall_min[axis] = at - wall_t * share_minus
        wall_max[axis] = at + wall_t * share_plus
        wall_bbox = AABB(min=wall_min, max=wall_max)

        # 墙在 A(=plus) 侧的面: axis min (plane_value = wall_max[axis]? 错) 再想:
        # + 侧 cabin 的 inner_bbox.min[axis] = wall_max_along_axis
        # 所以墙在 + 侧 "外法向" (指向 + 侧 cabin) 的面 = axis上 wall 的 max 面 = wall.xmax/ymax/zmax
        # 墙在 - 侧的面 = wall.xmin/ymin/zmin
        tag_plus = {0: "xmax", 1: "ymax", 2: "zmax"}[axis]
        tag_minus = {0: "xmin", 1: "ymin", 2: "zmin"}[axis]
        wall_id = f"wall_{cabin_plus_id}_{cabin_minus_id}"
        face_on_plus = _make_face_for_bbox(
            face_id=f"{wall_id}.face_on_{cabin_plus_id}",
            belongs_to=wall_id,
            side=f"+{'xyz'[axis]}",
            bbox=wall_bbox,
            face_tag=tag_plus,
        )
        face_on_minus = _make_face_for_bbox(
            face_id=f"{wall_id}.face_on_{cabin_minus_id}",
            belongs_to=wall_id,
            side=f"-{'xyz'[axis]}",
            bbox=wall_bbox,
            face_tag=tag_minus,
        )
        wall = CabinWall(
            id=wall_id,
            between=(cabin_plus_id, cabin_minus_id),
            bbox=wall_bbox,
            normal_axis=axis,
            thickness=wall_t,
            face_on_a=face_on_plus,
            face_on_b=face_on_minus,
            material=dict(wall_mat),
        )
        walls = [wall]
    else:
        walls = []

    # placement tree: virtual_split 根 + 两个 cabin 子树 (每 cabin 内再挂一个 leaf)
    root = PlacementNode(
        id="node.root",
        kind="virtual_split",
        bbox=AABB(min=inner_min.copy(), max=inner_max.copy()),
        parent=None,
        children=[f"node.{cabin_plus_id}", f"node.{cabin_minus_id}"],
        split_axis=axis,
        split_at=at,
    )
    nodes = [root]
    for cabin in (cabin_plus, cabin_minus):
        cab_node = PlacementNode(
            id=f"node.{cabin.id}",
            kind="cabin",
            bbox=AABB(min=cabin.inner_bbox.min.copy(), max=cabin.inner_bbox.max.copy()),
            parent=root.id,
            children=[f"leaf.{cabin.id}"],
            cabin_id=cabin.id,
        )
        leaf = PlacementNode(
            id=f"leaf.{cabin.id}",
            kind="leaf",
            bbox=AABB(min=cabin.inner_bbox.min.copy(), max=cabin.inner_bbox.max.copy()),
            parent=cab_node.id,
            children=[],
            mount_face_ids=[f.id for f in cabin.faces],
        )
        nodes.extend([cab_node, leaf])

    return [cabin_plus, cabin_minus], walls, nodes

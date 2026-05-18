"""v2 装箱: per-leaf + mount_face_id + kind-aware.

与 v1 ``pack_py3dbp.py`` 的差异:
- 输入从 ``List[AABB]`` bins 改为 ``List[PlacementNode(kind=leaf)]`` 叶节点,
  每个 leaf 自带 ``mount_face_ids`` (OrientedFace.id 列表).
- part 按 ``kind`` 分流:
  * internal → 走 cabin leaf 的内面 (faces_inner)
  * external/radiator → 走 outer_shell.faces_outer (外表面)
- part 产出的 ``mount_face_id`` 是字符串, 不再是 int 0..5.

复用 v1 的核心思路: 面任务打乱 + 切层 + 多启动评分, 但面任务对象换成了 OrientedFace。
"""
from __future__ import annotations

import random
from typing import Dict, List, NamedTuple, Optional, Tuple

import numpy as np

from src.schema_v2 import (
    AABB,
    OrientedFace,
    PartV2,
    PlacementNode,
    SatelliteModelV2,
    face_tag_to_axis_sign,
)

# py3dbp: 单朝向 2D 装箱 (沿用 v1 约定)
from py3dbp.constants import RotationType
RotationType.ALL = [RotationType.RT_WHD]
from py3dbp import Packer, Bin, Item


# ============================================================
# Part 的 install 尺寸 & 实际坐标 (v2 语义)
# ============================================================

def part_world_dims(part: PartV2, face: OrientedFace) -> np.ndarray:
    """把 part 的局部尺寸映射成挂到 ``face`` 之后的世界坐标尺寸.

    约定:
    - part.dims 在未放置前采用局部 (x, y, z) 语义;
    - 局部 z 轴是安装厚度方向;
    - 局部 x/y 轴落到安装面的两个面内方向 (u/v).

    这样 radiator/external 挂到 X/Y 外表面时，1mm 薄厚仍然会沿安装面法向，
    不会继续固定在世界 z 轴上。
    """
    local_dims = np.array(part.dims, dtype=float)
    axis = face.plane_axis
    other = [a for a in (0, 1, 2) if a != axis]
    world_dims = np.zeros(3, dtype=float)
    world_dims[other[0]] = float(local_dims[0])
    world_dims[other[1]] = float(local_dims[1])
    world_dims[axis] = float(local_dims[2])
    return world_dims


def part_install_dims(part: PartV2, face: OrientedFace) -> np.ndarray:
    """根据 part.clearance_mm 在 face 法向 + 两个面内方向分别加间隙 (对应 v1 get_install_dims)"""
    actual = part_world_dims(part, face)
    half_c = part.clearance_mm / 2.0
    full_c = part.clearance_mm

    # 面法向 → axis; 给半个 clearance
    mount_axis = face.plane_axis
    clearance_arr = np.full(3, full_c)
    clearance_arr[mount_axis] = half_c
    return actual + clearance_arr


def part_actual_position_from_install(
    part: PartV2, install_pos: np.ndarray, face: OrientedFace,
) -> np.ndarray:
    """v1 get_actual_position 的 v2 版: 把 install_pos 偏移成实际最小角坐标.

    outer 面 (external/radiator): 法向方向 offset=0 → 组件与外壳面贴合, 无缝隙.
    inner 面:
      normal_sign = -1: 法向方向 offset=0 (直接贴墙)
      normal_sign = +1: 法向方向 offset=half_clearance
    两个面内方向一律 + full_clearance.
    """
    full_c = part.clearance_mm
    half_c = part.clearance_mm / 2.0
    mount_axis = face.plane_axis

    offset = np.full(3, full_c)
    if face.side == "outer":
        # external/radiator 贴合外壳面, 法向无间隙
        offset[mount_axis] = 0.0
    elif face.normal_sign < 0:
        offset[mount_axis] = 0.0
    else:
        offset[mount_axis] = half_c

    return install_pos + offset


def part_mount_point(part: PartV2, install_pos: np.ndarray, face: OrientedFace) -> np.ndarray:
    """安装面上的接触中心点.

    mount axis 方向一律取 face.plane_value (定义上贴合), 其他两轴取 install 框的 2D 中心.
    这对 inner / outer 面都是正确的, 比 v1 直接加 dims 半宽更统一.
    """
    pos = np.array(install_pos, dtype=float)
    dims = part_world_dims(part, face)
    mount_axis = face.plane_axis
    mp = np.zeros(3, dtype=float)
    mp[mount_axis] = float(face.plane_value)
    for ax in range(3):
        if ax != mount_axis:
            mp[ax] = pos[ax] + dims[ax] / 2.0
    return mp


# ============================================================
# Face 的可用 2D 区域 & 厚度方向
# ============================================================

class FaceBoard(NamedTuple):
    face: OrientedFace
    u_ax: int           # 2D 板 u 轴对应的 3D axis
    v_ax: int
    u_min: float        # 当前剩余 2D 可用区域 (在 face 本地坐标下)
    u_max: float
    v_min: float
    v_max: float
    # 沿法向的剩余厚度 (切层用)
    thickness_remaining: float
    # 每次切层时剩余厚度减去该层最大 part thickness; 不超过 available_thickness_init 就行


def _face_initial_board(face: OrientedFace, leaf_bbox: AABB) -> FaceBoard:
    """给定 face + leaf bbox, 返回该面在 leaf 可用空间内的 2D 板 (初始全量)

    重要: face.bbox_2d 是 owner (cabin/outer_shell/wall) 的 face bbox, 但 leaf.bbox
    可能只占 owner 的一部分 (嵌套/keepout 情形); 此处取两者 2D 交集作为有效 2D 板.
    """
    axis = face.plane_axis
    other = [a for a in (0, 1, 2) if a != axis]
    u_ax, v_ax = other[0], other[1]

    face_u_min, face_u_max, face_v_min, face_v_max = face.bbox_2d
    leaf_u_min, leaf_u_max = leaf_bbox.min[u_ax], leaf_bbox.max[u_ax]
    leaf_v_min, leaf_v_max = leaf_bbox.min[v_ax], leaf_bbox.max[v_ax]
    u_min = max(face_u_min, float(leaf_u_min))
    u_max = min(face_u_max, float(leaf_u_max))
    v_min = max(face_v_min, float(leaf_v_min))
    v_max = min(face_v_max, float(leaf_v_max))

    # 厚度方向的可用深度 = leaf bbox 在 axis 方向的跨度
    thickness_remaining = float(leaf_bbox.max[axis] - leaf_bbox.min[axis])

    return FaceBoard(
        face=face, u_ax=u_ax, v_ax=v_ax,
        u_min=u_min, u_max=u_max, v_min=v_min, v_max=v_max,
        thickness_remaining=thickness_remaining,
    )


# ============================================================
# leaf 级状态: 管理多面 + 剩余厚度
# ============================================================

class LeafPacker:
    """单个 leaf 节点的状态: 持有可用面 + 当前剩余可用空间.

    和 v1 BinFaceMapper 的差别: v1 假设所有 face 都贴合 bin.AABB 的 6 个面;
    v2 的 face 可能是 wall 面, 不一定在 bin 六面之一 → 保守用 face.plane_value
    + leaf.bbox 求交集.
    """
    def __init__(self, leaf: PlacementNode, install_faces: Dict[str, OrientedFace]):
        self.leaf = leaf
        self.original_bbox = AABB(min=leaf.bbox.min.copy(), max=leaf.bbox.max.copy())
        self.remaining_bbox = AABB(min=leaf.bbox.min.copy(), max=leaf.bbox.max.copy())
        self.face_ids: List[str] = list(leaf.mount_face_ids)
        self.install_faces = install_faces

    def get_board(self, face_id: str) -> Optional[FaceBoard]:
        face = self.install_faces.get(face_id)
        if face is None:
            return None
        board = _face_initial_board(face, self.remaining_bbox)
        if board.u_max - board.u_min <= 0 or board.v_max - board.v_min <= 0:
            return None
        # 外表面 (装 external/radiator): 永远可用, 不做 "面在 leaf.remaining 边界" 检查
        # 内部面: face 的 plane_value 必须还在 leaf remaining 边界上 (否则已被前一层切掉)
        if face.side != "outer":
            axis = face.plane_axis
            if face.normal_sign < 0:
                if abs(face.plane_value - self.remaining_bbox.min[axis]) > 1e-3:
                    return None
            else:
                if abs(face.plane_value - self.remaining_bbox.max[axis]) > 1e-3:
                    return None
        return board

    def cut_after_face(self, face_id: str, max_thickness: float) -> None:
        """在 face 的法向方向从 leaf 剩余空间砍掉一层."""
        face = self.install_faces[face_id]
        if max_thickness <= 0:
            return
        axis = face.plane_axis
        if face.normal_sign < 0:
            self.remaining_bbox.min[axis] += max_thickness
        else:
            self.remaining_bbox.max[axis] -= max_thickness
        # 钳制
        self.remaining_bbox.min = np.minimum(self.remaining_bbox.min, self.remaining_bbox.max)


# ============================================================
# 单面装箱 (2D)
# ============================================================

def _pack_parts_on_face(
    leaf: LeafPacker,
    face_id: str,
    candidate_parts: List[PartV2],
) -> Tuple[List[PartV2], List[PartV2]]:
    """在 leaf 的某张 face 上做 2D 装箱, 返回 (已放置 part, 剩余 part)."""
    if not candidate_parts:
        return [], candidate_parts

    board = leaf.get_board(face_id)
    if board is None:
        return [], candidate_parts

    face = leaf.install_faces[face_id]
    W = board.u_max - board.u_min
    H = board.v_max - board.v_min
    if W <= 0 or H <= 0:
        return [], candidate_parts

    packer = Packer()
    packer.add_bin(Bin(f"LEAF_{leaf.leaf.id}_F_{face_id}", float(W), float(H), 1.0, max_weight=99999))

    id2part: Dict[str, PartV2] = {p.id: p for p in candidate_parts}

    for p in candidate_parts:
        install_dims = part_install_dims(p, face)
        # 2D 投影
        u_len = float(install_dims[board.u_ax])
        v_len = float(install_dims[board.v_ax])
        thickness = float(install_dims[face.plane_axis])
        # 剔除比面还大的 part
        if u_len > W or v_len > H or thickness > board.thickness_remaining:
            continue
        item = Item(p.id, u_len, v_len, 1.0, p.mass)
        packer.add_item(item)

    packer.pack(distribute_items=False, bigger_first=True, number_of_decimals=0)

    b = packer.bins[0]
    if not b.items:
        return [], candidate_parts

    placed: List[PartV2] = []
    max_thickness = 0.0
    placed_ids = set()

    for it in b.items:
        p = id2part[it.name]
        actual_dims = part_world_dims(p, face)
        install_dims = part_install_dims(p, face)
        u = float(it.position[0])
        v = float(it.position[1])

        # (u, v) 2D → 3D install_pos
        install_pos = np.zeros(3, dtype=float)
        axis = face.plane_axis
        u_ax, v_ax = board.u_ax, board.v_ax
        # u/v 轴: 加到 board 基点
        install_pos[u_ax] = board.u_min + u
        install_pos[v_ax] = board.v_min + v
        # 法向轴放置方向:
        #   inner 面 (cabin 面 / 墙面 / outer 的 inner 面): part 向 "封闭区域内" 挤出 (与 normal_sign 相反)
        #   outer 面 (outer_shell.faces_outer): part 向 "壳外" 挤出 (与 normal_sign 同向)
        thickness = float(install_dims[axis])
        max_thickness = max(max_thickness, thickness)
        if face.side == "outer":
            # 外挂贴合: 使用 actual dims (不含 clearance), offset=0 → 组件紧贴外壳面
            # normal>0: component.min = plane_value; normal<0: component.max = plane_value
            actual_dim_axis = float(actual_dims[axis])
            if face.normal_sign > 0:
                install_pos[axis] = face.plane_value
            else:
                install_pos[axis] = face.plane_value - actual_dim_axis
        else:
            # 内挤: normal<0 → install.min = plane; normal>0 → install.max = plane (即 install.min = plane-thickness)
            if face.normal_sign < 0:
                install_pos[axis] = face.plane_value
            else:
                install_pos[axis] = face.plane_value - thickness

        # 实际坐标
        actual_pos = part_actual_position_from_install(p, install_pos, face)
        mp = part_mount_point(p, install_pos, face)

        placed_part = PartV2(
            id=p.id, kind=p.kind, category=p.category,
            dims=tuple(float(v) for v in actual_dims.tolist()), mass=p.mass, power=p.power,
            color=p.color, clearance_mm=p.clearance_mm, shape=p.shape,
            model=p.model,
            mount_face_id=face_id,
            position=actual_pos,
            install_pos=install_pos,
            mount_point=mp,
            leaf_node_id=leaf.leaf.id,
            thermal_surface=dict(p.thermal_surface),
            thermal_interface=dict(p.thermal_interface),
            thermoelastic=dict(p.thermoelastic),
        )
        placed.append(placed_part)
        placed_ids.add(p.id)

    leaf.cut_after_face(face_id, max_thickness)
    remaining = [p for p in candidate_parts if p.id not in placed_ids]
    return placed, remaining


# ============================================================
# 3D 重叠计数 (用于评分)
# ============================================================

def _overlap_count(placed: List[PartV2]) -> int:
    eps = 1e-6
    n = len(placed)
    overlaps = 0
    for i in range(n):
        pa = placed[i]
        if pa.position is None:
            continue
        da = np.array(pa.dims, dtype=float)
        mina = pa.position
        maxa = pa.position + da
        for j in range(i + 1, n):
            pb = placed[j]
            if pb.position is None:
                continue
            if pa.leaf_node_id != pb.leaf_node_id:
                continue
            if pa.mount_face_id == pb.mount_face_id:
                # 同面: 依赖 2D 装箱自身不会重叠
                continue
            db = np.array(pb.dims, dtype=float)
            minb = pb.position
            maxb = pb.position + db
            ox = (mina[0] < maxb[0] - eps) and (minb[0] < maxa[0] - eps)
            oy = (mina[1] < maxb[1] - eps) and (minb[1] < maxa[1] - eps)
            oz = (mina[2] < maxb[2] - eps) and (minb[2] < maxa[2] - eps)
            if ox and oy and oz:
                overlaps += 1
    return overlaps


# ============================================================
# 单次 run + 多启动
# ============================================================

def _single_run(
    parts: List[PartV2],
    leaves: List[PlacementNode],
    outer_shell_face_ids_for_external: List[str],
    install_faces: Dict[str, OrientedFace],
    rng: random.Random,
    *,
    shuffle: bool,
) -> Tuple[List[PartV2], List[PartV2], Dict[str, float]]:
    """一次 pack 尝试. 内组件走 cabin leaves, 外组件 (external/radiator) 走 outer.faces_outer.

    外组件用一个虚拟 "outer_leaf" (bbox = outer shell 外法向无限, 近似为 shell.inner 外扩),
    mount_face_ids = outer_shell.faces_outer 的 id.
    """
    leaf_packers: Dict[str, LeafPacker] = {
        l.id: LeafPacker(l, install_faces) for l in leaves
    }

    # 生成 "外组件 leaf": 共享一个 LeafPacker, bbox 是足够大的虚拟盒 (为了不限制厚度)
    # 一条实用规则: 外贴的组件不与内部或彼此互斥 (除非同面 2D 冲突), 所以厚度视为无限
    outer_leaf = PlacementNode(
        id="leaf.outer",
        kind="leaf",
        bbox=AABB(min=np.array([-1e6, -1e6, -1e6]), max=np.array([1e6, 1e6, 1e6])),
        mount_face_ids=list(outer_shell_face_ids_for_external),
    )
    # 注意: outer leaf 的 remaining 是无限, face board 裁剪到 face.bbox_2d
    leaf_packers[outer_leaf.id] = LeafPacker(outer_leaf, install_faces)

    internal_parts = [p for p in parts if p.kind == "internal"]
    external_parts = [p for p in parts if p.kind in ("external", "radiator")]
    if shuffle:
        rng.shuffle(internal_parts)
        rng.shuffle(external_parts)
    else:
        internal_parts.sort(key=_part_volume, reverse=True)
        external_parts.sort(key=_part_volume, reverse=True)

    placed_all: List[PartV2] = []

    # --- 内部组件: 所有 cabin leaves × 各自 mount_face_ids ---
    internal_tasks: List[Tuple[str, str]] = []  # (leaf_id, face_id)
    for l in leaves:
        for fid in l.mount_face_ids:
            internal_tasks.append((l.id, fid))
    if shuffle:
        rng.shuffle(internal_tasks)

    remaining_internal = list(internal_parts)
    for leaf_id, face_id in internal_tasks:
        if not remaining_internal:
            break
        placed, remaining_internal = _pack_parts_on_face(
            leaf_packers[leaf_id], face_id, remaining_internal,
        )
        placed_all.extend(placed)

    # --- 外部组件: outer_leaf × faces_outer ---
    external_tasks: List[Tuple[str, str]] = [
        (outer_leaf.id, fid) for fid in outer_shell_face_ids_for_external
    ]
    if shuffle:
        rng.shuffle(external_tasks)
    remaining_external = list(external_parts)
    for leaf_id, face_id in external_tasks:
        if not remaining_external:
            break
        placed, remaining_external = _pack_parts_on_face(
            leaf_packers[leaf_id], face_id, remaining_external,
        )
        placed_all.extend(placed)

    unplaced = remaining_internal + remaining_external

    overlaps = _overlap_count(placed_all)
    placed_volume = float(sum(np.prod(p.dims) for p in placed_all))
    used_leaves = len({p.leaf_node_id for p in placed_all if p.leaf_node_id})

    stats = {
        "overlap_count": float(overlaps),
        "placed_count": float(len(placed_all)),
        "placed_volume": placed_volume,
        "used_leaves": float(used_leaves),
    }
    return placed_all, unplaced, stats


def _part_volume(part: PartV2) -> float:
    return float(np.prod(part.dims))


def multistart_pack_v2(
    model: SatelliteModelV2,
    parts: List[PartV2],
    multistart: int = 3,
    external_on_outer: bool = True,
    seed: int | None = None,
) -> Tuple[List[PartV2], List[PartV2]]:
    """对外主接口.

    Args:
        model: 已构建的 SatelliteModelV2 (parts 为空; 本函数把 placed 写回 model.parts 可在上层处理)
        parts: 待装组件列表 (带 kind)
        multistart: 多启动次数
        external_on_outer: 是否允许 external/radiator 装 outer_shell.faces_outer (默认 true)

    Returns:
        (placed, unplaced)
    """
    leaves = [n for n in model.placement_tree if n.kind == "leaf"]
    if not leaves:
        raise ValueError("no leaf placement nodes available")

    # 哪些 face 给 external/radiator
    outer_face_ids = []
    if external_on_outer:
        outer_face_ids = [f.id for f in model.outer_shell.faces_outer]

    print(
        f"\n[v2 pack] {len(parts)} parts, {len(leaves)} leaves, "
        f"outer_faces={len(outer_face_ids)}, multistart={multistart}"
    )
    if not parts:
        return [], []

    best_placed: List[PartV2] = []
    best_unplaced: List[PartV2] = list(parts)
    best_score = (float("-inf"), -1.0, 0.0, float("-inf"))

    rng = random.Random(seed)
    for run in range(multistart):
        placed, unplaced, stats = _single_run(
            parts,
            leaves,
            outer_face_ids,
            model.install_faces,
            rng,
            shuffle=run > 0,
        )
        score = (
            -stats["overlap_count"],
            stats["placed_count"],
            stats["placed_volume"],
            -stats["used_leaves"],
        )
        print(
            f"  run {run+1}/{multistart}: "
            f"overlaps={int(stats['overlap_count'])}, "
            f"placed={int(stats['placed_count'])}/{len(parts)}, "
            f"vol={stats['placed_volume']:.0f}, used_leaves={int(stats['used_leaves'])}"
        )
        if score > best_score:
            best_score = score
            best_placed = placed
            best_unplaced = unplaced

    print(
        f"[v2 pack] best: overlaps={-int(best_score[0])}, "
        f"placed={int(best_score[1])}/{len(parts)}, "
        f"vol={best_score[2]:.0f}"
    )
    return best_placed, best_unplaced

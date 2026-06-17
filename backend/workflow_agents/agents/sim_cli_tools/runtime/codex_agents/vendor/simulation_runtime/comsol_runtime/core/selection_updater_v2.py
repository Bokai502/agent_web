"""Selection 更新模块 v2

与 v1 SelectionUpdater 的差异:
- v1: 硬编码 6 个 sel_shell_* + 每组件 1 个 Box Selection, 假设壳心在原点
- v2: 数据驱动, 读 sample.yaml v2 的
  * install_faces 注册表 → 每面一个 entitydim=2 的薄盒 face Selection
  * cabin_walls → 每墙一个 entitydim=3 的 wall Selection (Box 套墙 AABB)
  * cabins → 每仓一个 entitydim=3 的 cabin volume Selection (可选, 用于材料指派)
  * components → 沿用 v1 的 per-part Box Selection (entitydim=3)

v2 不假设壳心在原点: 所有面/墙的真实 3D 坐标从 install_faces.center_xyz /
wall.bbox / cabin.inner_bbox 直接读取.
"""
from typing import Any, Dict, List, Optional


# ============================================================
# COMSOL tag 安全化: 把不安全字符替换为下划线
# ============================================================

def _safe_tag(s: str) -> str:
    """COMSOL tag 安全字符集: alnum + 下划线. 把 '.' 变为 '__' 保留可读性, 其他字符替换为 '_'"""
    out = []
    for ch in s:
        if ch == ".":
            out.append("__")
        elif ch.isalnum() or ch == "_":
            out.append(ch)
        else:
            out.append("_")
    return "".join(out)


def component_mount_face_bounds_from_target_plane(
    pos_mm: List[float],
    dims_mm: List[float],
    mount_face: Dict[str, Any],
    eps_mm: float = 1.0,
) -> List[List[float]]:
    """计算组件实际热交界面的 Box Selection 边界.

    component_mount_face_id/local_* 描述的是组件自身语义面，不直接等于装配后的
    全局坐标方向。实际热交界面由目标安装面的全局 plane_axis/plane_value 决定:
    取组件 bbox 在该轴上离目标平面最近的一侧。
    """
    bounds = [
        [float(pos_mm[0]), float(pos_mm[0]) + float(dims_mm[0])],
        [float(pos_mm[1]), float(pos_mm[1]) + float(dims_mm[1])],
        [float(pos_mm[2]), float(pos_mm[2]) + float(dims_mm[2])],
    ]
    axis = int(mount_face["plane_axis"])
    target_plane = float(mount_face["plane_value"])
    lower, upper = bounds[axis]
    plane_value = lower if abs(lower - target_plane) <= abs(upper - target_plane) else upper
    bounds[axis] = [plane_value - eps_mm, plane_value + eps_mm]
    return bounds


# ============================================================
# SelectionUpdaterV2
# ============================================================

class SelectionUpdaterV2:
    """v2 Selection 管理器: 按 sample.yaml v2 数据结构创建 Named Box Selection."""

    def __init__(self, model):
        self.model = model
        self.comp = model.java.component("comp1")

    # -------- 组件体 Selection (entitydim=3) --------
    def create_component_box_selections(self, components_data: List[Dict]) -> Dict[str, Any]:
        """每个组件一个 Box Selection (entitydim=3), 与 v1 行为一致.

        Args:
            components_data: [{name, pos_mm, dims_mm, power_W, category, kind?, ...}]
        """
        print("  [v2] 创建组件 Box Selections...")
        created_count = 0
        failed_tags: List[str] = []
        success_tags: List[str] = []

        for comp in components_data:
            tag = comp["name"]
            pos = comp["pos_mm"]
            dims = comp["dims_mm"]
            try:
                self._upsert_box_selection(
                    tag=tag,
                    label=tag,
                    xmin=f"{pos[0]}[mm]", xmax=f"{pos[0] + dims[0]}[mm]",
                    ymin=f"{pos[1]}[mm]", ymax=f"{pos[1] + dims[1]}[mm]",
                    zmin=f"{pos[2]}[mm]", zmax=f"{pos[2] + dims[2]}[mm]",
                    entitydim=3,
                )
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: kind={comp.get('kind', '?')}, category={comp.get('category', '?')}")
            except Exception as e:
                failed_tags.append(tag)
                print(f"    ✗ {tag} 失败: {e}")

        print(f"    共创建 {created_count}/{len(components_data)} 个组件 Selection")
        return {
            "created": created_count,
            "failed": len(failed_tags),
            "tags": success_tags,
            "failed_tags": failed_tags,
        }

    # -------- 面 Selection (entitydim=2, 薄盒) --------
    def create_install_face_selections(
        self,
        install_faces: Dict[str, Dict[str, Any]],
        eps_mm: float = 1.0,
        outer_shell: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """把 sample.yaml 的 install_faces 注册表逐面转成 Named Box Selection (entitydim=2).

        每面用 center_xyz + extents_xyz + plane_axis 构造薄盒:
        - 法向轴: [plane_value - eps, plane_value + eps] 薄层
        - 面内 2 轴: center ± extents/2

        注意:
        当 condition=allvertices 时，面内再收缩会把完整矩形面也筛空，因此这里保留
        原始面内范围，仅靠法向薄层 + allvertices 避免误选相邻侧壁。
        """
        print(f"  [v2] 创建 install_faces 薄盒 Selections (eps={eps_mm}mm)...")
        created_count = 0
        failed_tags: List[str] = []
        success_tags: List[str] = []

        for fid, face in install_faces.items():
            tag = f"sel_f_{_safe_tag(fid)}"
            label = f"face:{fid}"

            plane_axis = int(face["plane_axis"])
            plane_value = float(face["plane_value"])
            bounds = self._install_face_bounds(face, plane_axis, plane_value, eps_mm, outer_shell)

            try:
                self._upsert_box_selection(
                    tag=tag, label=label,
                    xmin=f"{bounds[0][0]}[mm]", xmax=f"{bounds[0][1]}[mm]",
                    ymin=f"{bounds[1][0]}[mm]", ymax=f"{bounds[1][1]}[mm]",
                    zmin=f"{bounds[2][0]}[mm]", zmax=f"{bounds[2][1]}[mm]",
                    entitydim=2,
                )
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: axis={plane_axis} plane={plane_value:.2f} belongs_to={face.get('belongs_to')}")
            except Exception as e:
                failed_tags.append(tag)
                print(f"    ✗ {tag} 失败: {e}")

        print(f"    共创建 {created_count}/{len(install_faces)} 个 install_face Selection")
        return {
            "created": created_count,
            "failed": len(failed_tags),
            "tags": success_tags,
            "failed_tags": failed_tags,
        }

    def _install_face_bounds(
        self,
        face: Dict[str, Any],
        plane_axis: int,
        plane_value: float,
        eps_mm: float,
        outer_shell: Optional[Dict[str, Any]] = None,
    ) -> List[List[float]]:
        extents = face.get("extents_xyz")
        center = face.get("center_xyz")
        if isinstance(extents, list) and isinstance(center, list) and len(extents) == 3 and len(center) == 3:
            half = [float(extents[i]) / 2.0 for i in range(3)]
            c = [float(center[i]) for i in range(3)]
            bounds = [[c[i] - half[i], c[i] + half[i]] for i in range(3)]
        else:
            bbox = (outer_shell or {}).get("outer_bbox", {})
            bmin = bbox.get("min")
            bmax = bbox.get("max")
            if isinstance(bmin, list) and isinstance(bmax, list) and len(bmin) == 3 and len(bmax) == 3:
                bounds = [[float(bmin[i]), float(bmax[i])] for i in range(3)]
            else:
                bounds = [[0.0, 0.0] for _ in range(3)]
        bounds[plane_axis] = [plane_value - eps_mm, plane_value + eps_mm]
        return bounds

    # -------- 墙体 Selection (entitydim=3) --------
    def create_wall_box_selections(
        self,
        cabin_walls: List[Dict[str, Any]],
        inflate_mm: float = 0.2,
    ) -> Dict[str, Any]:
        """每堵 CabinWall 一个体积 Box Selection (entitydim=3), 微膨胀以兼容网格浮点.

        Args:
            cabin_walls: sample.yaml['cabin_walls']
            inflate_mm: 沿每一维外扩的距离, 避免 bbox 恰好卡边
        """
        print(f"  [v2] 创建 cabin_walls 体积 Selections (inflate={inflate_mm}mm)...")
        created_count = 0
        failed_tags: List[str] = []
        success_tags: List[str] = []
        boundary_mode_tags: List[str] = []

        for wall in cabin_walls:
            wid = wall["id"]
            tag = f"sel_w_{_safe_tag(wid)}"
            label = f"wall:{wid}"

            if str(wall.get("modeling") or wall.get("entity_model") or "").lower() in {
                "conductive_boundary",
                "boundary",
            }:
                boundary_mode_tags.append(tag)
                print(f"    - {tag}: conductive boundary metadata; no wall volume selection")
                continue

            bbox = wall["bbox"]
            bmin = [float(v) for v in bbox["min"]]
            bmax = [float(v) for v in bbox["max"]]
            # 微膨胀
            bmin = [bmin[i] - inflate_mm for i in range(3)]
            bmax = [bmax[i] + inflate_mm for i in range(3)]

            try:
                self._upsert_box_selection(
                    tag=tag, label=label,
                    xmin=f"{bmin[0]}[mm]", xmax=f"{bmax[0]}[mm]",
                    ymin=f"{bmin[1]}[mm]", ymax=f"{bmax[1]}[mm]",
                    zmin=f"{bmin[2]}[mm]", zmax=f"{bmax[2]}[mm]",
                    entitydim=3,
                )
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: thickness={wall.get('thickness')}, between={wall.get('between')}")
            except Exception as e:
                failed_tags.append(tag)
                print(f"    ✗ {tag} 失败: {e}")

        print(f"    共创建 {created_count}/{len(cabin_walls)} 个 cabin_wall Selection")
        return {
            "created": created_count,
            "failed": len(failed_tags),
            "tags": success_tags,
            "failed_tags": failed_tags,
            "boundary_mode_tags": boundary_mode_tags,
            "boundary_mode_count": len(boundary_mode_tags),
        }

    # -------- cabin 体积 Selection (entitydim=3) --------
    def create_cabin_volume_selections(
        self,
        cabins: List[Dict[str, Any]],
        shrink_mm: float = 0.5,
    ) -> Dict[str, Any]:
        """每个 Cabin 一个体积 Box Selection (entitydim=3) 套 cabin.inner_bbox.

        shrink_mm 向内收缩, 避免选到墙体表面边界.
        用于 (后续) 给舱内空气域指派材料 / 按 cabin 做分区统计.
        """
        print(f"  [v2] 创建 cabin 内部体积 Selections (shrink={shrink_mm}mm)...")
        created_count = 0
        failed_tags: List[str] = []
        success_tags: List[str] = []

        for cabin in cabins:
            cid = cabin["id"]
            tag = f"sel_c_{_safe_tag(cid)}"
            label = f"cabin:{cid}"

            inner_bbox = cabin["inner_bbox"]
            bmin = [float(v) + shrink_mm for v in inner_bbox["min"]]
            bmax = [float(v) - shrink_mm for v in inner_bbox["max"]]
            # 保证 max > min (cabin 太薄时)
            for i in range(3):
                if bmax[i] <= bmin[i]:
                    mid = (float(inner_bbox["min"][i]) + float(inner_bbox["max"][i])) / 2.0
                    bmin[i] = mid - 0.1
                    bmax[i] = mid + 0.1

            try:
                self._upsert_box_selection(
                    tag=tag, label=label,
                    xmin=f"{bmin[0]}[mm]", xmax=f"{bmax[0]}[mm]",
                    ymin=f"{bmin[1]}[mm]", ymax=f"{bmax[1]}[mm]",
                    zmin=f"{bmin[2]}[mm]", zmax=f"{bmax[2]}[mm]",
                    entitydim=3,
                )
                created_count += 1
                success_tags.append(tag)
                print(f"    ✓ {tag}: bbox inner_size≈{[bmax[i]-bmin[i] for i in range(3)]}")
            except Exception as e:
                failed_tags.append(tag)
                print(f"    ✗ {tag} 失败: {e}")

        print(f"    共创建 {created_count}/{len(cabins)} 个 cabin 体积 Selection")
        return {
            "created": created_count,
            "failed": len(failed_tags),
            "tags": success_tags,
            "failed_tags": failed_tags,
        }

    # -------- 内部: upsert Box Selection --------
    def _upsert_box_selection(
        self,
        tag: str, label: str,
        xmin: str, xmax: str,
        ymin: str, ymax: str,
        zmin: str, zmax: str,
        entitydim: int = 3,
        condition: str = "allvertices",
    ) -> None:
        """创建或更新 Named Box Selection.

        COMSOL Box Selection 的默认 ``intersects`` 对薄盒边界选择会误选相邻外框。
        v2 统一切到 ``allvertices``，要求目标实体的顶点全部落在框内。
        """
        if tag not in list(self.comp.selection().tags()):
            self.comp.selection().create(tag, "Box")
        sel = self.comp.selection(tag)
        sel.label(label)
        sel.set("entitydim", str(entitydim))
        sel.set("condition", condition)
        sel.set("xmin", xmin)
        sel.set("xmax", xmax)
        sel.set("ymin", ymin)
        sel.set("ymax", ymax)
        sel.set("zmin", zmin)
        sel.set("zmax", zmax)

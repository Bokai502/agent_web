"""CAD导出模块 - 基于CadQuery"""
import json
from typing import List, Dict, Tuple
import cadquery as cq
from cadquery.occ_impl.shapes import Face
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.gp import gp_Pln, gp_Pnt, gp_Dir
from src.schema import Part, Envelope


def create_sheet_envelope_faces(
    outer_size: Tuple[float, float, float],
    center: Tuple[float, float, float]
) -> List[Tuple[cq.Workplane, str, cq.Location]]:
    """
    创建6个矩形面组成片体外壳（当厚度为0时）
    
    参数:
        outer_size: 外壳尺寸 [x, y, z]
        center: 外壳中心点 [x, y, z]
    
    返回:
        列表，每个元素为 (Workplane面对象, 面名称, Location位置)
    """
    sx, sy, sz = outer_size
    cx, cy, cz = center
    
    # 计算6个面的位置（相对于中心）
    half_x, half_y, half_z = sx / 2, sy / 2, sz / 2
    
    faces = []
    
    # X+ 面：在 x = cx + half_x 位置，YZ平面
    # 注意：BRepBuilderAPI_MakeFace对于YZ平面，参数顺序是(Z_min, Z_max, Y_min, Y_max)
    plane_xp = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0))  # 法向+X
    face_maker_xp = BRepBuilderAPI_MakeFace(plane_xp, -half_z, half_z, -half_y, half_y)
    face_xp = Face(face_maker_xp.Face())
    wp_xp = cq.Workplane('YZ').newObject([face_xp])
    loc_xp = cq.Location(cq.Vector(cx + half_x, cy, cz))
    faces.append((wp_xp, "ENVELOPE_X_PLUS", loc_xp))
    
    # X- 面：在 x = cx - half_x 位置，YZ平面（法向-X）
    # 注意：BRepBuilderAPI_MakeFace对于YZ平面，参数顺序是(Z_min, Z_max, Y_min, Y_max)
    plane_xm = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(-1, 0, 0))  # 法向-X
    face_maker_xm = BRepBuilderAPI_MakeFace(plane_xm, -half_z, half_z, -half_y, half_y)
    face_xm = Face(face_maker_xm.Face())
    wp_xm = cq.Workplane('YZ').newObject([face_xm])
    loc_xm = cq.Location(cq.Vector(cx - half_x, cy, cz))
    faces.append((wp_xm, "ENVELOPE_X_MINUS", loc_xm))
    
    # Y+ 面：在 y = cy + half_y 位置，XZ平面
    # 注意：BRepBuilderAPI_MakeFace对于XZ平面，参数顺序是(Z_min, Z_max, X_min, X_max)
    plane_yp = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0))  # 法向+Y
    face_maker_yp = BRepBuilderAPI_MakeFace(plane_yp, -half_z, half_z, -half_x, half_x)
    face_yp = Face(face_maker_yp.Face())
    wp_yp = cq.Workplane('XZ').newObject([face_yp])
    loc_yp = cq.Location(cq.Vector(cx, cy + half_y, cz))
    faces.append((wp_yp, "ENVELOPE_Y_PLUS", loc_yp))
    
    # Y- 面：在 y = cy - half_y 位置，XZ平面（法向-Y）
    # 注意：BRepBuilderAPI_MakeFace对于XZ平面，参数顺序是(Z_min, Z_max, X_min, X_max)
    plane_ym = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, -1, 0))  # 法向-Y
    face_maker_ym = BRepBuilderAPI_MakeFace(plane_ym, -half_z, half_z, -half_x, half_x)
    face_ym = Face(face_maker_ym.Face())
    wp_ym = cq.Workplane('XZ').newObject([face_ym])
    loc_ym = cq.Location(cq.Vector(cx, cy - half_y, cz))
    faces.append((wp_ym, "ENVELOPE_Y_MINUS", loc_ym))
    
    # Z+ 面：在 z = cz + half_z 位置，XY平面
    plane_zp = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))  # 法向+Z
    face_maker_zp = BRepBuilderAPI_MakeFace(plane_zp, -half_x, half_x, -half_y, half_y)
    face_zp = Face(face_maker_zp.Face())
    wp_zp = cq.Workplane('XY').newObject([face_zp])
    loc_zp = cq.Location(cq.Vector(cx, cy, cz + half_z))
    faces.append((wp_zp, "ENVELOPE_Z_PLUS", loc_zp))
    
    # Z- 面：在 z = cz - half_z 位置，XY平面（法向-Z）
    plane_zm = gp_Pln(gp_Pnt(0, 0, 0), gp_Dir(0, 0, -1))  # 法向-Z
    face_maker_zm = BRepBuilderAPI_MakeFace(plane_zm, -half_x, half_x, -half_y, half_y)
    face_zm = Face(face_maker_zm.Face())
    wp_zm = cq.Workplane('XY').newObject([face_zm])
    loc_zm = cq.Location(cq.Vector(cx, cy, cz - half_z))
    faces.append((wp_zm, "ENVELOPE_Z_MINUS", loc_zm))
    
    return faces


def export_cad(
    envelope: Envelope,
    placed: List[Part],
    out_step: str,
    out_meta: str
) -> None:
    """
    导出CAD文件和元数据
    
    参数:
        placed: 已放置件列表
        out_step: STEP文件输出路径
        out_meta: JSON元数据输出路径
    """
    print(f"\n导出CAD: {len(placed)} 件设备")
    
    # 验证安装面贴合情况（快速检查）
    face_names = ['-X', '+X', '-Y', '+Y', '-Z', '+Z']
    bin_bounds = envelope.inner
    max_gap = 1e-6
    
    for part in placed:
        actual_pos = part.get_actual_position()
        dims = part.get_actual_dims()
        mount_face = part.mount_face
        mount_axis = mount_face // 2
        
        if mount_face % 2 == 0:  # 负方向面
            gap = abs(actual_pos[mount_axis] - bin_bounds.min[mount_axis])
        else:  # 正方向面
            gap = abs((actual_pos[mount_axis] + dims[mount_axis]) - bin_bounds.max[mount_axis])
        
        max_gap = max(max_gap, gap)
    
    if max_gap > 0.01:
        print(f"  ⚠ 警告：检测到最大安装面间隙 {max_gap:.2f}mm")
    else:
        print(f"  ✓ 安装面贴合检查通过（最大间隙 {max_gap:.4f}mm）")
    
    # 创建Assembly
    assy = cq.Assembly()
    
    # 添加舱体外壳
    outer_size = envelope.outer_size()
    inner_size = envelope.inner_size()
    center = envelope.outer.center()
    center_tuple = (float(center[0]), float(center[1]), float(center[2]))
    outer_size_tuple = (float(outer_size[0]), float(outer_size[1]), float(outer_size[2]))
    inner_size_tuple = (float(inner_size[0]), float(inner_size[1]), float(inner_size[2]))
    
    # 根据厚度选择创建实体或片体
    if envelope.thickness_mm <= 1e-6:
        # 厚度为0：创建6个矩形面（片体）
        print(f"  创建片体外壳（厚度=0）：6个矩形面")
        sheet_faces = create_sheet_envelope_faces(outer_size_tuple, center_tuple)
        for wp_face, face_name, face_loc in sheet_faces:
            assy.add(
                wp_face,
                name=face_name,
                loc=face_loc,
                color=cq.Color(0.7, 0.7, 0.7, 0.15)
            )
    else:
        # 厚度>0：使用实体减法创建壳体
        outer_box = cq.Workplane("XY").box(*outer_size_tuple)
        inner_box = cq.Workplane("XY").box(*inner_size_tuple)
        shell = outer_box.cut(inner_box)
        assy.add(
            shell,
            name="ENVELOPE_SHELL",
            loc=cq.Location(cq.Vector(*center_tuple)),
            color=cq.Color(0.7, 0.7, 0.7, 0.15)
        )
        print(f"  创建实体外壳（厚度={envelope.thickness_mm}mm）")
    
    # 元数据字典（使用无单位后缀的字段名）
    is_sheet = (envelope.thickness_mm == 0)
    metadata = {
        "_units": {
            "length": "mm",
            "mass": "kg",
            "power": "W"
        },
        "_envelope": {
            "outer_size": outer_size.tolist(),
            "inner_size": inner_size.tolist(),
            "thickness": envelope.thickness_mm,
            "fill_ratio": envelope.fill_ratio,
            "size_ratio": list(envelope.size_ratio),
            "is_sheet": is_sheet
        }
    }
    
    for part in placed:
        # 使用实际坐标和实际尺寸
        actual_pos = part.get_actual_position()
        dims = part.get_actual_dims()
        
        # 创建盒体（CadQuery坐标系）
        box = cq.Workplane("XY").box(dims[0], dims[1], dims[2])
        
        # 计算中心位置（CadQuery的box以中心为原点）
        center_x = actual_pos[0] + dims[0] / 2
        center_y = actual_pos[1] + dims[1] / 2
        center_z = actual_pos[2] + dims[2] / 2
        
        # 添加到装配体（移动到正确位置）
        assy.add(
            box,
            name=part.id,
            loc=cq.Location(cq.Vector(center_x, center_y, center_z)),
            color=cq.Color(
                part.color[0] / 255.0,
                part.color[1] / 255.0,
                part.color[2] / 255.0,
                part.color[3] / 255.0
            )
        )
        
        # 记录元数据（使用无单位后缀的字段名）
        part_meta = {
            "shape": getattr(part, 'shape', 'box'),  # 新增shape字段
            "pos": [float(actual_pos[0]), float(actual_pos[1]), float(actual_pos[2])],
            "dims": [float(dims[0]), float(dims[1]), float(dims[2])],
            "category": part.category,
            "mass": float(part.mass),
            "power": float(part.power),
            "bin_index": int(part.bin_index),
            "mount_face": int(part.mount_face) if part.mount_face is not None else None,
            "mount_point": part.mount_point.tolist() if part.mount_point is not None else None,
            "install_pos": part.position.tolist() if part.position is not None else None  # 记录安装坐标用于调试
        }
        
        # 添加预留字段（thermal, thermoelastic）如果存在
        if hasattr(part, 'thermal'):
            part_meta['thermal'] = part.thermal
        if hasattr(part, 'thermoelastic'):
            part_meta['thermoelastic'] = part.thermoelastic
        
        metadata[part.id] = part_meta
    
    # 导出STEP文件
    assy.save(out_step)
    print(f"  已保存STEP: {out_step}")
    
    # 导出JSON元数据
    with open(out_meta, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    print(f"  已保存元数据: {out_meta}")
    
    # 统计信息
    total_mass = sum(part.mass for part in placed)
    total_power = sum(part.power for part in placed)
    print(f"  总质量: {total_mass:.2f} kg")
    print(f"  总功率: {total_power:.2f} W")

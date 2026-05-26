"""
将 COMSOL 导出的 data1.txt 转换为 VTU 文件，然后调用 ParaView 渲染流程。

data1.txt 格式:
  以 % 开头的注释行
  每行: x,y,z,T (逗号分隔)

用法:
    pvpython render_from_txt.py <data1.txt> <output_dir> [--array-name T]

也可单独用于 txt→vtu 转换:
    pvpython render_from_txt.py <data1.txt> <output_dir> --convert-only
"""

import argparse
import json
import os
import sys
from pathlib import Path

# pvpython 可能缺少 dist-packages 路径
_dist = "/usr/lib/python3/dist-packages"
if _dist not in sys.path:
    sys.path.insert(0, _dist)

from paraview import vtk
from vtkmodules.vtkIOXML import vtkXMLUnstructuredGridWriter, vtkXMLStructuredGridWriter


def parse_comsol_txt(txt_path):
    """解析 COMSOL data1.txt 格式"""
    points = []
    temperatures = []
    metadata = {}

    with open(txt_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("%"):
                # 解析元数据
                if ":" in line:
                    key, _, val = line[1:].partition(":")
                    metadata[key.strip()] = val.strip()
                continue
            if not line:
                continue
            parts = line.split(",")
            if len(parts) >= 4:
                x, y, z, t = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])
                points.append((x, y, z))
                temperatures.append(t)

    return points, temperatures, metadata


def _infer_grid_dims(points):
    """从 coord.txt 顺序推断 (nx, ny, nz).

    我们的 COMSOL 输出按 X(outer) > Y(mid) > Z(inner) 遍历，
    所以 Z 变化最快：row 0..nz-1 是同一 (x0,y0) 的 Z 扫描。
    """
    if len(points) < 2:
        raise ValueError("点数过少, 无法推断网格维度")

    x0 = points[0][0]
    y0 = points[0][1]

    # 找 Z 轴长度：从头开始, 到 (x,y) 第一次变化为止
    nz = 1
    for i in range(1, len(points)):
        x, y, _z = points[i]
        if x != x0 or y != y0:
            break
        nz += 1
    else:
        nz = len(points)

    # Y 轴长度: 在同一 X 下, Y 出现过多少个不同值
    ny = 1
    if nz < len(points):
        for i in range(nz, len(points), nz):
            x, _y, _z = points[i]
            if x != x0:
                break
            ny += 1

    nx = len(points) // (ny * nz)
    if nx * ny * nz != len(points):
        raise ValueError(
            f"点总数 {len(points)} 无法整除为 nx*ny*nz = {nx}*{ny}*{nz}"
        )
    return nx, ny, nz


def create_structured_vts(points, temperatures, output_path, array_name="T"):
    """把规则 coord.txt 重建为 vtkStructuredGrid (.vts)。

    保留 NaN (用于 ParaView Threshold 过滤几何外区域),
    这样 Slice / Contour / Volume 都能在真实 3D 连续场上做插值,
    从而生成云图而非点云。
    """
    nx, ny, nz = _infer_grid_dims(points)
    total = nx * ny * nz
    assert total == len(points) == len(temperatures)

    # VTK StructuredGrid 的点顺序约定: i(dim0) 最快, 然后 j, 然后 k
    # 我们的文件顺序是: X(slowest) > Y(mid) > Z(fastest)
    # 因此直接把 dims 设为 (nz, ny, nx), 文件顺序 = VTK 顺序
    vtk_dims = (nz, ny, nx)

    vtk_points = vtk.vtkPoints()
    vtk_points.SetNumberOfPoints(total)
    temp_array = vtk.vtkDoubleArray()
    temp_array.SetName(array_name)
    temp_array.SetNumberOfComponents(1)
    temp_array.SetNumberOfTuples(total)

    for idx, ((x, y, z), t) in enumerate(zip(points, temperatures)):
        vtk_points.SetPoint(idx, x, y, z)
        temp_array.SetValue(idx, t)

    grid = vtk.vtkStructuredGrid()
    grid.SetDimensions(vtk_dims)
    grid.SetPoints(vtk_points)
    grid.GetPointData().AddArray(temp_array)
    grid.GetPointData().SetActiveScalars(array_name)

    writer = vtkXMLStructuredGridWriter()
    writer.SetFileName(str(output_path))
    writer.SetInputData(grid)
    # 用 ASCII 模式保证 XML 可解析 (appended binary 在 NaN 存在时易触发
    # "not well-formed" 解析错误); 32^3 float64 ≈ 3MB ASCII, 可接受
    writer.SetDataModeToAscii()
    writer.Write()

    return output_path, vtk_dims


def create_vtu_from_points(points, temperatures, output_path, array_name="T"):
    """[DEPRECATED] 逐点 VTK_VERTEX VTU (仅产生点云, 保留作兜底)。"""
    vtk_points = vtk.vtkPoints()
    vtk_cells = vtk.vtkCellArray()
    temp_array = vtk.vtkDoubleArray()
    temp_array.SetName(array_name)
    temp_array.SetNumberOfComponents(1)

    for i, (x, y, z) in enumerate(points):
        vtk_points.InsertNextPoint(x, y, z)
        vtk_cells.InsertNextCell(1)
        vtk_cells.InsertCellPoint(i)
        temp_array.InsertNextValue(temperatures[i])

    grid = vtk.vtkUnstructuredGrid()
    grid.SetPoints(vtk_points)
    grid.SetCells(vtk.VTK_VERTEX, vtk_cells)
    grid.GetPointData().AddArray(temp_array)
    grid.GetPointData().SetActiveScalars(array_name)

    writer = vtkXMLUnstructuredGridWriter()
    writer.SetFileName(str(output_path))
    writer.SetInputData(grid)
    writer.SetDataModeToAscii()
    writer.Write()

    return output_path


def txt_to_vtu(txt_path, output_dir, array_name="T"):
    """把 data1.txt 转成 StructuredGrid VTS (规则 32^3 网格).

    关键改动 (vs VTU_VERTEX 点云):
      * 保留 NaN: 写入 grid 但不过滤, ParaView 用 Threshold/mask 决定显示
      * 使用 vtkStructuredGrid 重建 3D 拓扑, Slice / Contour / Volume 都能做真插值
      * 输出文件扩展名为 .vts (ParaView 原生 structured grid), 但下游 OpenDataFile
        支持 .vts/.vtu 统一处理
    """
    txt_path = Path(txt_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"解析 COMSOL 文本数据: {txt_path}")
    points, temperatures, metadata = parse_comsol_txt(txt_path)

    if not points:
        print("错误: 未找到有效数据点", file=sys.stderr)
        return None

    # 统计 NaN/Inf 数 (不丢弃, 保留在结构化网格中)
    nan_count = 0
    valid_temps = []
    for t in temperatures:
        if t != t or abs(t) == float("inf"):
            nan_count += 1
        else:
            valid_temps.append(t)

    print(
        f"总数据点: {len(points)}, 有效温度: {len(valid_temps)}, NaN/Inf: {nan_count}"
    )

    if not valid_temps:
        print("错误: 没有有效的温度值", file=sys.stderr)
        return None

    vts_path = output_dir / f"{txt_path.stem}.vts"
    print(f"生成 StructuredGrid VTS 文件: {vts_path}")
    _, dims = create_structured_vts(points, temperatures, vts_path, array_name)
    print(f"StructuredGrid 维度 (i,j,k)=({dims[0]},{dims[1]},{dims[2]}) "
          f"= {dims[0]*dims[1]*dims[2]} 点")

    min_t = min(valid_temps)
    max_t = max(valid_temps)
    mean_t = sum(valid_temps) / len(valid_temps)
    print(f"温度范围: {min_t:.2f} K ~ {max_t:.2f} K (均值: {mean_t:.2f} K)")

    return {
        # 对外 key 仍叫 vtu_path, 下游 pvpython OpenDataFile 对 .vts/.vtu 透明
        "vtu_path": str(vts_path),
        "grid_type": "vtkStructuredGrid",
        "grid_dims": list(dims),
        "source_txt": str(txt_path),
        "metadata": metadata,
        "stats": {
            "total_points": len(points),
            "valid_points": len(valid_temps),
            "nan_count": nan_count,
            "min_K": min_t,
            "max_K": max_t,
            "mean_K": mean_t,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="COMSOL txt → VTU 转换 + ParaView 渲染")
    parser.add_argument("input_txt", type=str, help="输入 data1.txt 文件路径")
    parser.add_argument("output_dir", type=str, help="输出目录")
    parser.add_argument("--array-name", type=str, default="T",
                        help="温度数组名称（默认 T）")
    parser.add_argument("--convert-only", action="store_true",
                        help="仅转换为 VTU，不渲染")
    parser.add_argument("--width", type=int, default=1920, help="图片宽度")
    parser.add_argument("--height", type=int, default=1080, help="图片高度")
    args = parser.parse_args()

    result = txt_to_vtu(args.input_txt, args.output_dir, args.array_name)
    if result is None:
        sys.exit(1)

    if args.convert_only:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # 调用 ParaView 渲染
    from render_temperature import render_temperature

    render_dir = Path(args.output_dir) / "renders"
    render_result = render_temperature(
        result["vtu_path"],
        str(render_dir),
        array_name=args.array_name,
        image_size=(args.width, args.height),
    )

    if render_result is None:
        print("渲染失败", file=sys.stderr)
        sys.exit(1)

    combined = {
        "conversion": result,
        "rendering": render_result,
    }

    manifest_path = Path(args.output_dir) / "pipeline_manifest.json"
    with open(str(manifest_path), "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
    print(f"完整流程摘要: {manifest_path}")
    print(json.dumps(combined, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

"""
ParaView 温度场后处理脚本 (StructuredGrid 云图版)

适配 `render_from_txt.py` 产出的 vtkStructuredGrid (.vts) 或真 COMSOL VTU:
  1. NaN 用 Threshold 过滤, 得到真实几何体
  2. 3D: Surface 代表 (外表面) + Volume 代表 (体渲染) 两种
  3. 切片: Slice + Surface 代表, 输出 2D 插值云图
  4. 等值面: Contour 5 层, 展示温度分层
  5. 颜色: Inferno colormap + 色条

用法:
    pvpython render_temperature.py <input.vts|vtu> <output_dir> [--array-name T]
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

from paraview.simple import (
    Contour,
    CreateRenderView,
    Delete,
    GetColorTransferFunction,
    GetOpacityTransferFunction,
    GetScalarBar,
    Hide,
    OpenDataFile,
    ResetCamera,
    SaveScreenshot,
    Show,
    Slice,
    Threshold,
)


NAN_SENTINEL_MIN = -1e20
NAN_SENTINEL_MAX = 1e20


def find_temperature_array(source):
    info = source.GetPointDataInformation()
    # "Color" 是 COMSOL Plot export 默认数组名 (无论物理量是什么, 它写成 plot 颜色字段)
    candidates = ["T", "Temperature", "temperature", "temp", "Temp", "Color"]
    for name in candidates:
        arr = info.GetArray(name)
        if arr is not None:
            return name
    for i in range(info.GetNumberOfArrays()):
        arr = info.GetArray(i)
        if arr.GetNumberOfComponents() == 1:
            return arr.GetName()
    return None


def get_data_bounds(source):
    source.UpdatePipeline()
    bounds = source.GetDataInformation().GetBounds()
    return {
        "xmin": bounds[0], "xmax": bounds[1],
        "ymin": bounds[2], "ymax": bounds[3],
        "zmin": bounds[4], "zmax": bounds[5],
    }


def get_temperature_stats(source, array_name):
    source.UpdatePipeline()
    info = source.GetPointDataInformation()
    arr = info.GetArray(array_name)
    if arr is None:
        return None
    ranges = arr.GetRange()
    return {
        "array_name": array_name,
        "min_K": ranges[0],
        "max_K": ranges[1],
        "num_points": source.GetDataInformation().GetNumberOfPoints(),
        "num_cells": source.GetDataInformation().GetNumberOfCells(),
    }


def make_valid_source(source, array_name):
    """用 Threshold 过滤 NaN (StructuredGrid 规则网格中几何外的点).

    NaN 在 VTK Range 里表现为非常大的区间外值, 直接用 [min, max] 有限范围过滤即可。
    """
    source.UpdatePipeline()
    info = source.GetPointDataInformation()
    arr = info.GetArray(array_name)
    if arr is None:
        return source, None
    rng = arr.GetRange()
    lo, hi = rng[0], rng[1]
    # 若 range 本身已排除 NaN (VTK 默认忽略 NaN 统计), 直接用之
    if lo != lo or hi != hi or lo < NAN_SENTINEL_MIN or hi > NAN_SENTINEL_MAX:
        # 极端场: range 里含 inf/NaN, 用一个宽松区间
        lo, hi = 100.0, 1000.0
    thresh = Threshold(Input=source)
    # ThresholdRange 被 ParaView 5.10 废弃, 改用 LowerThreshold/UpperThreshold
    try:
        thresh.LowerThreshold = lo
        thresh.UpperThreshold = hi
    except Exception:
        # 老版本回退
        thresh.ThresholdRange = [lo, hi]
    try:
        thresh.Scalars = ["POINTS", array_name]
    except Exception:
        pass
    thresh.UpdatePipeline()
    return thresh, (lo, hi)


def setup_color_bar(view, lut, array_name, title_suffix="(K)"):
    scalar_bar = GetScalarBar(lut, view)
    scalar_bar.Title = f"{array_name} {title_suffix}"
    scalar_bar.ComponentTitle = ""
    scalar_bar.Visibility = 1
    scalar_bar.ScalarBarLength = 0.55
    scalar_bar.TitleFontSize = 18
    scalar_bar.LabelFontSize = 14
    # 白底必须用黑字, 否则色标标签全白看不见
    try:
        scalar_bar.TitleColor = [0.0, 0.0, 0.0]
        scalar_bar.LabelColor = [0.0, 0.0, 0.0]
    except Exception:
        pass
    # 显式打开数值标签
    try:
        scalar_bar.AutomaticLabelFormat = 0
        scalar_bar.LabelFormat = "%.1f"
        scalar_bar.RangeLabelFormat = "%.1f"
        scalar_bar.AddRangeLabels = 1
        scalar_bar.DrawTickMarks = 1
        scalar_bar.DrawTickLabels = 1
    except Exception:
        pass
    try:
        scalar_bar.UseCustomLabels = 0
        scalar_bar.NumberOfLabels = 6
    except Exception:
        pass
    return scalar_bar


def _apply_camera(view, preset, bounds):
    mx = (bounds["xmin"] + bounds["xmax"]) / 2
    my = (bounds["ymin"] + bounds["ymax"]) / 2
    mz = (bounds["zmin"] + bounds["zmax"]) / 2
    span = max(
        bounds["xmax"] - bounds["xmin"],
        bounds["ymax"] - bounds["ymin"],
        bounds["zmax"] - bounds["zmin"],
    )
    d = span * 2.2
    view.CameraFocalPoint = [mx, my, mz]
    if preset == "iso_front":
        view.CameraPosition = [mx + d, my + d, mz + d * 0.7]
        view.CameraViewUp = [0, 0, 1]
    elif preset == "iso_back":
        view.CameraPosition = [mx - d, my - d, mz + d * 0.7]
        view.CameraViewUp = [0, 0, 1]
    elif preset == "top":
        view.CameraPosition = [mx, my, mz + d]
        view.CameraViewUp = [0, 1, 0]
    elif preset == "front":
        view.CameraPosition = [mx, my - d, mz]
        view.CameraViewUp = [0, 0, 1]
    elif preset == "right":
        view.CameraPosition = [mx + d, my, mz]
        view.CameraViewUp = [0, 0, 1]


def render_3d_surface(source, array_name, output_dir, bounds, image_size):
    """多角度 Surface 云图 (外表面着色)."""
    output_dir = Path(output_dir)
    lut = GetColorTransferFunction(array_name)
    lut.ApplyPreset("Inferno (matplotlib)", True)
    lut.NanColor = [0.3, 0.3, 0.3]
    lut.NanOpacity = 0.0

    rendered = []
    for preset in ["iso_front", "iso_back", "top", "front", "right"]:
        view = CreateRenderView()
        view.ViewSize = list(image_size)
        # 取消配色板绑定, 显式设置白底
        try:
            view.UseColorPaletteForBackground = 0
        except Exception:
            pass
        view.Background = [1.0, 1.0, 1.0]
        try:
            view.Background2 = [1.0, 1.0, 1.0]
            view.BackgroundColorMode = "Single Color"
        except Exception:
            pass
        try:
            view.OrientationAxesVisibility = 1
        except Exception:
            pass

        disp = Show(source, view)
        disp.Representation = "Surface"
        disp.ColorArrayName = ["POINTS", array_name]
        disp.LookupTable = lut
        # 打开面插值, 避免块状
        try:
            disp.InterpolateScalarsBeforeMapping = 1
        except Exception:
            pass

        setup_color_bar(view, lut, array_name)
        # 先设方向, 再 ResetCamera 自动计算合适的距离
        _apply_camera(view, preset, bounds)
        ResetCamera(view)

        out = output_dir / f"3d_{preset}.png"
        SaveScreenshot(str(out), view, ImageResolution=list(image_size))
        rendered.append(str(out))

        Hide(source, view)
        Delete(view)

    return rendered


def render_3d_volume(source, array_name, output_dir, bounds, image_size):
    """体渲染云图 (透明度贯穿整个温度场)."""
    output_dir = Path(output_dir)
    lut = GetColorTransferFunction(array_name)
    lut.ApplyPreset("Inferno (matplotlib)", True)
    opacity = GetOpacityTransferFunction(array_name)

    rendered = []
    for preset in ["iso_front", "iso_back"]:
        view = CreateRenderView()
        view.ViewSize = list(image_size)
        # 取消配色板绑定, 显式设置白底
        try:
            view.UseColorPaletteForBackground = 0
        except Exception:
            pass
        view.Background = [1.0, 1.0, 1.0]
        try:
            view.Background2 = [1.0, 1.0, 1.0]
            view.BackgroundColorMode = "Single Color"
        except Exception:
            pass
        try:
            view.OrientationAxesVisibility = 1
        except Exception:
            pass

        disp = Show(source, view)
        try:
            disp.Representation = "Volume"
            disp.ColorArrayName = ["POINTS", array_name]
            disp.LookupTable = lut
            disp.ScalarOpacityFunction = opacity
        except Exception as e:
            print(f"Volume 代表不可用 ({preset}): {e}", file=sys.stderr)
            Delete(view)
            continue

        setup_color_bar(view, lut, array_name)
        _apply_camera(view, preset, bounds)
        ResetCamera(view)

        out = output_dir / f"volume_{preset}.png"
        SaveScreenshot(str(out), view, ImageResolution=list(image_size))
        rendered.append(str(out))

        Hide(source, view)
        Delete(view)

    return rendered


def render_slices(source, array_name, output_dir, bounds, image_size):
    """三正交切片云图 (Slice + Surface 插值着色)."""
    output_dir = Path(output_dir)
    lut = GetColorTransferFunction(array_name)
    lut.ApplyPreset("Inferno (matplotlib)", True)

    mx = (bounds["xmin"] + bounds["xmax"]) / 2
    my = (bounds["ymin"] + bounds["ymax"]) / 2
    mz = (bounds["zmin"] + bounds["zmax"]) / 2
    span = max(
        bounds["xmax"] - bounds["xmin"],
        bounds["ymax"] - bounds["ymin"],
        bounds["zmax"] - bounds["zmin"],
    )
    d = span * 1.6

    specs = {
        "slice_xy": {
            "normal": [0, 0, 1],
            "origin": [mx, my, mz],
            "cam_pos": [mx, my, mz + d],
            "cam_up": [0, 1, 0],
        },
        "slice_xz": {
            "normal": [0, 1, 0],
            "origin": [mx, my, mz],
            "cam_pos": [mx, my - d, mz],
            "cam_up": [0, 0, 1],
        },
        "slice_yz": {
            "normal": [1, 0, 0],
            "origin": [mx, my, mz],
            "cam_pos": [mx + d, my, mz],
            "cam_up": [0, 0, 1],
        },
    }

    rendered = []
    for name, s in specs.items():
        sl = Slice(Input=source)
        sl.SliceType = "Plane"
        sl.SliceType.Origin = s["origin"]
        sl.SliceType.Normal = s["normal"]
        try:
            sl.Triangulatetheslice = 1
        except Exception:
            pass
        sl.UpdatePipeline()

        # 切片几何 bounds (而非整个体的 bounds), 用于对相机正确取景
        sb = sl.GetDataInformation().GetBounds()
        slice_span = max(sb[1] - sb[0], sb[3] - sb[2], sb[5] - sb[4])
        if slice_span <= 0:
            slice_span = span  # fallback to full bounds
        slice_cx = (sb[0] + sb[1]) / 2
        slice_cy = (sb[2] + sb[3]) / 2
        slice_cz = (sb[4] + sb[5]) / 2

        view = CreateRenderView()
        view.ViewSize = list(image_size)
        # 取消配色板绑定, 显式设置白底
        try:
            view.UseColorPaletteForBackground = 0
        except Exception:
            pass
        view.Background = [1.0, 1.0, 1.0]
        try:
            view.Background2 = [1.0, 1.0, 1.0]
            view.BackgroundColorMode = "Single Color"
        except Exception:
            pass
        try:
            view.OrientationAxesVisibility = 1
        except Exception:
            pass

        disp = Show(sl, view)
        disp.Representation = "Surface"
        disp.ColorArrayName = ["POINTS", array_name]
        disp.LookupTable = lut
        try:
            disp.InterpolateScalarsBeforeMapping = 1
        except Exception:
            pass

        setup_color_bar(view, lut, array_name)
        # 改用平行投影, 切片视角下没有透视收缩, 取景更紧
        view.CameraParallelProjection = 1
        # 相机围绕切片中心放置 (不是整个体的中心), 这样切片始终位于画面中央
        focal = [slice_cx, slice_cy, slice_cz]
        # cam_pos 仍按 specs 给的方向偏移, 但以切片中心为基准
        offset = [s["cam_pos"][i] - s["origin"][i] for i in range(3)]
        view.CameraFocalPoint = focal
        view.CameraPosition = [focal[i] + offset[i] for i in range(3)]
        view.CameraViewUp = s["cam_up"]
        # ParallelScale 控制视野半高, 留 15% 边距
        view.CameraParallelScale = slice_span * 0.6

        out = output_dir / f"{name}.png"
        SaveScreenshot(str(out), view, ImageResolution=list(image_size))
        rendered.append(str(out))

        Hide(sl, view)
        Delete(view)
        Delete(sl)

    return rendered


def render_contour(source, array_name, output_dir, bounds, stats, image_size):
    """等值面云图 (5 层温度)."""
    output_dir = Path(output_dir)
    lut = GetColorTransferFunction(array_name)
    lut.ApplyPreset("Inferno (matplotlib)", True)

    lo = stats["min_K"]
    hi = stats["max_K"]
    levels = [lo + (hi - lo) * f for f in (0.15, 0.35, 0.55, 0.75, 0.9)]

    contour = Contour(Input=source)
    contour.ContourBy = ["POINTS", array_name]
    contour.Isosurfaces = levels
    try:
        contour.PointMergeMethod = "Uniform Binning"
    except Exception:
        pass
    contour.UpdatePipeline()

    # 等值面真实 bounds (可能比体小, 比如所有 iso 都堆在中心)
    cb = contour.GetDataInformation().GetBounds()
    contour_bounds = {
        "xmin": cb[0], "xmax": cb[1],
        "ymin": cb[2], "ymax": cb[3],
        "zmin": cb[4], "zmax": cb[5],
    }

    rendered = []
    for preset in ["iso_front", "top"]:
        view = CreateRenderView()
        view.ViewSize = list(image_size)
        # 取消配色板绑定, 显式设置白底
        try:
            view.UseColorPaletteForBackground = 0
        except Exception:
            pass
        view.Background = [1.0, 1.0, 1.0]
        try:
            view.Background2 = [1.0, 1.0, 1.0]
            view.BackgroundColorMode = "Single Color"
        except Exception:
            pass
        try:
            view.OrientationAxesVisibility = 1
        except Exception:
            pass

        disp = Show(contour, view)
        disp.Representation = "Surface"
        disp.ColorArrayName = ["POINTS", array_name]
        disp.LookupTable = lut

        setup_color_bar(view, lut, array_name, title_suffix="(K) iso")
        # 用等值面 bounds 而非整个体 bounds 设相机
        _apply_camera(view, preset, contour_bounds)
        # ResetCamera 会重新计算视距来贴合可见物体, 保留我们设定的方向
        ResetCamera(view)

        out = output_dir / f"contour_{preset}.png"
        SaveScreenshot(str(out), view, ImageResolution=list(image_size))
        rendered.append(str(out))

        Hide(contour, view)
        Delete(view)

    Delete(contour)
    return rendered


def render_temperature(input_vtu, output_dir, array_name=None, image_size=(1920, 1080)):
    input_vtu = Path(input_vtu)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"加载数据文件: {input_vtu}")
    reader = OpenDataFile(str(input_vtu))
    reader.UpdatePipeline()

    # 如果 caller 指定了名字但 VTU 里不存在 (比如 caller 传 "T" 但 COMSOL Plot 写的是 "Color"),
    # 自动回退到检测
    if array_name is not None:
        info = reader.GetPointDataInformation()
        if info.GetArray(array_name) is None:
            print(f"指定的数组 '{array_name}' 不存在, 自动检测...", file=sys.stderr)
            array_name = None
    if array_name is None:
        array_name = find_temperature_array(reader)
    if array_name is None:
        print("错误: 未找到温度数组", file=sys.stderr)
        return None
    print(f"使用温度数组: {array_name}")

    # 对规则 StructuredGrid (NaN 标记几何外区域) 过滤掉 NaN, 得到真实体
    valid_src, rng = make_valid_source(reader, array_name)
    print(f"Threshold 区间 (NaN 过滤): {rng}")

    bounds = get_data_bounds(valid_src)
    stats = get_temperature_stats(valid_src, array_name)
    print(f"温度范围: {stats['min_K']:.2f} K ~ {stats['max_K']:.2f} K")
    print(f"有效点数: {stats['num_points']}, 单元数: {stats['num_cells']}")

    # 显式把 LUT 范围设到真实数据范围 (否则 Plot/Color 数组默认 0-1 色标)
    try:
        lut = GetColorTransferFunction(array_name)
        lut.RescaleTransferFunction(stats["min_K"], stats["max_K"])
    except Exception as e:
        print(f"LUT rescale 失败 (忽略): {e}", file=sys.stderr)

    print("渲染 3D Surface 云图...")
    v3d = render_3d_surface(valid_src, array_name, output_dir, bounds, image_size)
    print("渲染切片云图...")
    vsl = render_slices(valid_src, array_name, output_dir, bounds, image_size)
    print("渲染等值面云图...")
    vct = render_contour(valid_src, array_name, output_dir, bounds, stats, image_size)
    print("渲染 Volume 体云图 (可选)...")
    try:
        vvol = render_3d_volume(valid_src, array_name, output_dir, bounds, image_size)
    except Exception as e:
        print(f"Volume 渲染失败, 跳过: {e}", file=sys.stderr)
        vvol = []

    summary = {
        "input_file": str(input_vtu),
        "array_name": array_name,
        "grid_type": "structured_or_unstructured",
        "bounds": bounds,
        "temperature": stats,
        "outputs": {
            "3d_views": v3d,
            "slices": vsl,
            "contours": vct,
            "volume": vvol,
        },
    }

    summary_path = output_dir / "summary.json"
    with open(str(summary_path), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"摘要已保存: {summary_path}")

    Delete(valid_src)
    Delete(reader)
    return summary


def main():
    parser = argparse.ArgumentParser(description="ParaView 温度场云图后处理")
    parser.add_argument("input_vtu", type=str, help="输入 .vts / .vtu 文件路径")
    parser.add_argument("output_dir", type=str, help="输出目录")
    parser.add_argument("--array-name", type=str, default=None,
                        help="温度数组名称 (默认自动检测)")
    parser.add_argument("--width", type=int, default=1920, help="图片宽度")
    parser.add_argument("--height", type=int, default=1080, help="图片高度")
    args = parser.parse_args()

    result = render_temperature(
        args.input_vtu,
        args.output_dir,
        array_name=args.array_name,
        image_size=(args.width, args.height),
    )
    if result is None:
        sys.exit(1)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

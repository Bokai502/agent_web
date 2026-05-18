"""三维可视化模块 - 基于matplotlib的静态3D绘图"""
from typing import List, Optional
import numpy as np
from src.schema import AABB, Part, Envelope

import matplotlib
matplotlib.use('Agg')  # 非交互式后端
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def plot_box_wireframe(ax, min_pt: np.ndarray, max_pt: np.ndarray, color: str, alpha: float = 0.3, linewidth: float = 1.0):
    """绘制盒体线框
    
    参数:
        ax: matplotlib 3D axes
        min_pt: 最小点 [x, y, z]
        max_pt: 最大点 [x, y, z]
        color: 颜色
        alpha: 透明度
        linewidth: 线宽
    """
    # 定义8个顶点
    x = [min_pt[0], max_pt[0]]
    y = [min_pt[1], max_pt[1]]
    z = [min_pt[2], max_pt[2]]
    
    vertices = []
    for i in range(2):
        for j in range(2):
            for k in range(2):
                vertices.append([x[i], y[j], z[k]])
    vertices = np.array(vertices)
    
    # 定义12条边
    edges = [
        [0, 1], [2, 3], [4, 5], [6, 7],  # x方向的边
        [0, 2], [1, 3], [4, 6], [5, 7],  # y方向的边
        [0, 4], [1, 5], [2, 6], [3, 7],  # z方向的边
    ]
    
    for edge in edges:
        points = vertices[edge]
        ax.plot3D(*points.T, color=color, alpha=alpha, linewidth=linewidth)


def plot_box_filled(ax, min_pt: np.ndarray, max_pt: np.ndarray, color: tuple, alpha: float = 0.3):
    """绘制填充盒体（半透明面片）
    
    参数:
        ax: matplotlib 3D axes
        min_pt: 最小点 [x, y, z]
        max_pt: 最大点 [x, y, z]
        color: RGBA颜色元组 (r, g, b, a)，值范围0-255
        alpha: 透明度覆盖（如果提供）
    """
    # 归一化颜色到0-1
    if len(color) == 4 and max(color) > 1:
        color = tuple(c / 255.0 for c in color)
    elif len(color) == 3:
        if max(color) > 1:
            color = tuple(c / 255.0 for c in color) + (alpha,)
        else:
            color = color + (alpha,)
    
    # 定义8个顶点
    x = [min_pt[0], max_pt[0]]
    y = [min_pt[1], max_pt[1]]
    z = [min_pt[2], max_pt[2]]
    
    vertices = np.array([
        [x[0], y[0], z[0]],  # 0
        [x[1], y[0], z[0]],  # 1
        [x[1], y[1], z[0]],  # 2
        [x[0], y[1], z[0]],  # 3
        [x[0], y[0], z[1]],  # 4
        [x[1], y[0], z[1]],  # 5
        [x[1], y[1], z[1]],  # 6
        [x[0], y[1], z[1]],  # 7
    ])
    
    # 定义6个面
    faces = [
        [vertices[0], vertices[1], vertices[2], vertices[3]],  # 底面 z=min
        [vertices[4], vertices[5], vertices[6], vertices[7]],  # 顶面 z=max
        [vertices[0], vertices[1], vertices[5], vertices[4]],  # 前面 y=min
        [vertices[2], vertices[3], vertices[7], vertices[6]],  # 后面 y=max
        [vertices[0], vertices[3], vertices[7], vertices[4]],  # 左面 x=min
        [vertices[1], vertices[2], vertices[6], vertices[5]],  # 右面 x=max
    ]
    
    # 创建Poly3DCollection
    poly = Poly3DCollection(faces, facecolors=color, linewidths=0.5, edgecolors='gray', alpha=color[3] if len(color) == 4 else alpha)
    ax.add_collection3d(poly)


def viz_bins_and_keepouts(
    envelope: Envelope,
    bins: List[AABB],
    keepouts: List[AABB],
    outfile: Optional[str] = None
) -> None:
    """可视化舱体、子容器和禁区
    
    参数:
        envelope: 舱体AABB
        bins: 可用子容器列表
        keepouts: 禁区列表
        outfile: 输出文件路径（PNG）
    """
    print(f"\n可视化: 舱体 + {len(bins)} 个子容器 + {len(keepouts)} 个禁区")
    
    fig = plt.figure(figsize=(12, 10))
    ax = fig.add_subplot(111, projection='3d')
    
    # 舱体外壳（半透明灰）
    plot_box_filled(ax, envelope.outer.min, envelope.outer.max, (180, 180, 180, 40))
    
    # 内部可用边界（线框，淡灰）
    plot_box_wireframe(ax, envelope.inner.min, envelope.inner.max, 'gray', alpha=0.5, linewidth=1.0)
    
    # 可用子容器（淡青色）
    for b in bins:
        plot_box_filled(ax, b.min, b.max, (100, 200, 255, 30))
    
    # 禁区（红色透明）
    for k in keepouts:
        plot_box_filled(ax, k.min, k.max, (255, 0, 0, 60))
    
    # 设置坐标轴
    ax.set_xlabel('X (mm)')
    ax.set_ylabel('Y (mm)')
    ax.set_zlabel('Z (mm)')
    ax.set_title('Envelope + Bins + Keep-out Zones')
    
    # 设置等比例坐标轴
    all_points = np.vstack([envelope.outer.min, envelope.outer.max])
    max_range = np.ptp(all_points, axis=0).max() / 2.0
    mid = np.mean(all_points, axis=0)
    ax.set_xlim(mid[0] - max_range, mid[0] + max_range)
    ax.set_ylim(mid[1] - max_range, mid[1] + max_range)
    ax.set_zlim(mid[2] - max_range, mid[2] + max_range)
    
    # 保存或显示
    if outfile:
        plt.savefig(outfile, dpi=150, bbox_inches='tight')
        print(f"  已保存: {outfile}")
    else:
        plt.show()
    
    plt.close()


def viz_packing_preview(
    envelope: Envelope,
    bins: List[AABB],
    keepouts: List[AABB],
    placed: List[Part],
    unplaced: List[Part],
    outfile: Optional[str] = None
) -> None:
    """可视化装箱结果
    
    参数:
        envelope: 舱体AABB
        bins: 可用子容器列表
        keepouts: 禁区列表
        placed: 已放置件列表
        unplaced: 未放置件列表
        outfile: 输出文件路径（PNG）
    """
    print(f"\n可视化装箱结果: {len(placed)} 已放置, {len(unplaced)} 未放置")
    
    fig = plt.figure(figsize=(16, 12))
    
    # 子图1: 完整视图
    ax1 = fig.add_subplot(221, projection='3d')
    draw_packing_scene(ax1, envelope, bins, keepouts, placed, unplaced, show_bins=True)
    ax1.set_title(f'Complete View\n({len(placed)} placed, {len(unplaced)} unplaced)', fontsize=12)
    
    # 子图2: 仅设备视图
    ax2 = fig.add_subplot(222, projection='3d')
    draw_packing_scene(ax2, envelope, [], [], placed, [], show_bins=False)
    ax2.set_title('Placed Parts Only', fontsize=12)
    
    # 子图3: 俯视图
    ax3 = fig.add_subplot(223, projection='3d')
    draw_packing_scene(ax3, envelope, [], keepouts, placed, [], show_bins=False)
    ax3.view_init(elev=90, azim=0)  # 俯视
    ax3.set_title('Top View', fontsize=12)
    
    # 子图4: 侧视图
    ax4 = fig.add_subplot(224, projection='3d')
    draw_packing_scene(ax4, envelope, [], keepouts, placed, [], show_bins=False)
    ax4.view_init(elev=0, azim=0)  # 侧视
    ax4.set_title('Side View', fontsize=12)
    
    plt.tight_layout()
    
    # 保存或显示
    if outfile:
        plt.savefig(outfile, dpi=150, bbox_inches='tight')
        print(f"  已保存: {outfile}")
    else:
        plt.show()
    
    plt.close()


def draw_packing_scene(
    ax,
    envelope: Envelope,
    bins: List[AABB],
    keepouts: List[AABB],
    placed: List[Part],
    unplaced: List[Part],
    show_bins: bool = True
):
    """绘制装箱场景到指定axes
    
    参数:
        ax: matplotlib 3D axes
        envelope: 舱体AABB
        bins: 可用子容器列表
        keepouts: 禁区列表
        placed: 已放置件列表
        unplaced: 未放置件列表
        show_bins: 是否显示bins
    """
    # 舱体外壳（半透明灰线框）
    plot_box_wireframe(ax, envelope.outer.min, envelope.outer.max, 'gray', alpha=0.6, linewidth=1.5)
    
    # 内部边界（淡灰线框）
    plot_box_wireframe(ax, envelope.inner.min, envelope.inner.max, 'lightgray', alpha=0.4, linewidth=0.8)
    
    # 子容器（非常淡的青色，弱化显示）
    if show_bins:
        for b in bins:
            plot_box_filled(ax, b.min, b.max, (100, 200, 255, 15))
    
    # 禁区（红色透明）
    for k in keepouts:
        plot_box_filled(ax, k.min, k.max, (255, 0, 0, 80))
    
    # 已放置的设备（按类别着色）
    for part in placed:
        actual_pos = part.get_actual_position()
        dims = part.get_actual_dims()
        
        min_pt = actual_pos
        max_pt = actual_pos + dims
        
        plot_box_filled(ax, min_pt, max_pt, part.color, alpha=0.8)
    
    # 未放置的设备（紫色，堆放在舱外）
    if unplaced:
        offset_x = envelope.outer.max[0] + 100  # 舱外100mm
        offset_y = envelope.outer.min[1]
        offset_z = envelope.outer.min[2]
        
        stack_z = 0
        for part in unplaced:
            dims = part.get_actual_dims()
            min_pt = np.array([offset_x, offset_y, offset_z + stack_z])
            max_pt = min_pt + dims
            
            plot_box_filled(ax, min_pt, max_pt, (200, 100, 255, 200), alpha=0.8)
            stack_z += dims[2] + 10  # 间隔10mm堆叠
    
    # 设置坐标轴
    ax.set_xlabel('X (mm)', fontsize=10)
    ax.set_ylabel('Y (mm)', fontsize=10)
    ax.set_zlabel('Z (mm)', fontsize=10)
    
    # 设置等比例坐标轴（包含未放置件区域）
    all_x = [envelope.outer.min[0], envelope.outer.max[0]]
    all_y = [envelope.outer.min[1], envelope.outer.max[1]]
    all_z = [envelope.outer.min[2], envelope.outer.max[2]]
    
    if unplaced:
        all_x.append(offset_x + max([p.get_actual_dims()[0] for p in unplaced]))
    
    max_range = max(
        max(all_x) - min(all_x),
        max(all_y) - min(all_y),
        max(all_z) - min(all_z)
    ) / 2.0
    
    mid_x = (max(all_x) + min(all_x)) / 2.0
    mid_y = (max(all_y) + min(all_y)) / 2.0
    mid_z = (max(all_z) + min(all_z)) / 2.0
    
    ax.set_xlim(mid_x - max_range, mid_x + max_range)
    ax.set_ylim(mid_y - max_range, mid_y + max_range)
    ax.set_zlim(mid_z - max_range, mid_z + max_range)
    
    # 设置视角
    ax.view_init(elev=20, azim=45)

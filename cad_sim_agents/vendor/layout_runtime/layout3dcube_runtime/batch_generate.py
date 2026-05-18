"""批量数据生成主程序

步骤划分：
A. 加载分布定义（dist.yaml）
B. 生成N个样本配置（sample.yaml）
C. 对每个样本：布局 + 导出 + 数据处理

支持并行生成，记录生成速度
"""

import argparse
from pathlib import Path
import yaml
import numpy as np
import time
import json
from typing import Dict
from multiprocessing import Pool, cpu_count
import shutil


# ========== 步骤 A：分布定义 ==========
def load_distribution(dist_yaml: str) -> Dict:
    """加载分布定义"""
    with open(dist_yaml, encoding='utf-8') as f:
        return yaml.safe_load(f)


def sample_value(dist_range):
    """从分布范围中抽样"""
    if isinstance(dist_range, list) and len(dist_range) == 2:
        return float(np.random.uniform(dist_range[0], dist_range[1]))
    return dist_range


def generate_size_ratio(max_ratio_constraint: float = 2.0) -> list:
    """生成满足约束的舱体长宽高比例
    
    参数:
        max_ratio_constraint: 最长边/最短边的最大比例
    
    返回:
        [x_ratio, y_ratio, z_ratio] 三个比例值
    """
    # 策略：生成三个随机值，归一化后检查约束
    max_attempts = 100
    
    for _ in range(max_attempts):
        # 在[1.0, max_ratio_constraint]范围内生成三个值
        ratios = np.random.uniform(1.0, max_ratio_constraint, size=3)
        
        # 归一化：最小值设为1.0
        ratios = ratios / ratios.min()
        
        # 检查约束
        if ratios.max() / ratios.min() < max_ratio_constraint:
            return ratios.tolist()
    
    # 如果多次尝试都失败，返回保守值
    return [1.0, 1.5, 2]


# ========== 步骤 B：样本具体化 ==========
def generate_sample_config(dist: Dict, sample_id: str, seed: int) -> Dict:
    """从分布生成单个样本配置"""
    np.random.seed(seed)
    
    # 抽样envelope参数
    size_ratio_constraint = dist['envelope'].get('size_ratio_constraint', 2.0)
    envelope = {
        'fill_ratio': sample_value(dist['envelope']['fill_ratio']),
        'shell_thickness': sample_value(dist['envelope']['shell_thickness']),
        'size_ratio': generate_size_ratio(size_ratio_constraint),
        'auto_envelope': dist['envelope']['auto_envelope'],
        'shell_material': dist['envelope']['shell_material']
    }
    
    # 抽样packing参数
    packing = {
        'clearance': sample_value(dist['packing']['clearance']),
        'multistart': dist['packing']['multistart']
    }
    
    sample = {
        'units': dist['units'],
        'sample_id': sample_id,
        'seed': seed,
        'envelope': envelope,
        'components': {},  # 将由synth_bom生成并填充
        'packing': packing
    }
    
    return sample


def save_sample_yaml(sample: Dict, output_path: str):
    """保存样本配置"""
    with open(output_path, 'w', encoding='utf-8') as f:
        yaml.dump(sample, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


# ========== 步骤 C：布局与处理 ==========
def process_sample_wrapper(args):
    """包装器，用于并行处理 (按 schema_version 分派 v1/v2 处理器)"""
    sample_id, sample_config, sample_dir, dist = args

    schema_version = str(dist.get("schema_version", "1.0"))
    start_time = time.time()
    try:
        if schema_version.startswith("2"):
            from src.sample_processor_v2 import process_single_sample_v2
            stats = process_single_sample_v2(sample_config, sample_dir, dist)
        else:
            from src.sample_processor import process_single_sample
            stats = process_single_sample(sample_config, sample_dir, dist)
        elapsed = time.time() - start_time
        return {
            'sample_id': sample_id,
            'elapsed_seconds': elapsed,
            'stats': stats,
            'status': 'success'
        }
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"\n错误: 样本 {sample_id} 处理失败: {e}")
        import traceback
        traceback.print_exc()
        import sys
        sys.stdout.flush()

        return {
            'sample_id': sample_id,
            'elapsed_seconds': elapsed,
            'stats': {},
            'status': 'failed',
            'error': str(e)
        }


# ========== 主流程 ==========
def main():
    parser = argparse.ArgumentParser(description='批量生成卫星布局数据集')
    parser.add_argument('--dist', default='config/dist.yaml', help='分布定义文件')
    parser.add_argument('--output', default='output', help='输出根目录')
    parser.add_argument('--n_samples', type=int, default=10, help='生成样本数量')
    parser.add_argument('--start_id', type=int, default=1, help='起始样本ID')
    parser.add_argument('--parallel', type=int, default=1, 
                        help='并行进程数（1=串行，0=自动检测CPU核心数）')
    args = parser.parse_args()
    
    # 确定并行数
    if args.parallel == 0:
        n_workers = cpu_count()
    else:
        n_workers = args.parallel
    
    # A. 加载分布
    print("=" * 60)
    print("步骤 A：加载分布定义")
    print("=" * 60)
    dist = load_distribution(args.dist)
    dataset_name = dist['dataset']['name']
    print(f"数据集: {dataset_name}")
    print(f"并行进程数: {n_workers}")
    
    # 创建输出目录
    output_root = Path(args.output) / dataset_name
    output_root.mkdir(parents=True, exist_ok=True)
    
    # 复制dist.yaml到输出目录
    shutil.copy(args.dist, output_root / 'dist.yaml')
    print(f"已复制分布定义到: {output_root / 'dist.yaml'}")
    
    # B. 生成样本配置
    print("\n" + "=" * 60)
    print("步骤 B：生成样本配置")
    print("=" * 60)
    
    schema_version = str(dist.get("schema_version", "1.0"))
    print(f"schema_version: {schema_version}")

    sample_tasks = []
    for i in range(args.n_samples):
        sample_id = f"{args.start_id + i:06d}"
        seed = dist.get('seed') or (42 + i)

        print(f"[{i+1}/{args.n_samples}] 准备样本 {sample_id} (seed={seed})")

        # B1. 生成样本配置 (按 schema_version 分派)
        if schema_version.startswith("2"):
            from src.sample_processor_v2 import generate_sample_config_v2
            sample_config = generate_sample_config_v2(dist, sample_id, seed)
        else:
            sample_config = generate_sample_config(dist, sample_id, seed)

        # B2. 创建样本目录
        sample_dir = output_root / "samples" / sample_id
        sample_dir.mkdir(parents=True, exist_ok=True)

        # B3. 保存sample.yaml（预留，布局后会更新）
        sample_yaml_path = sample_dir / "sample.yaml"
        save_sample_yaml(sample_config, str(sample_yaml_path))

        # 收集任务
        sample_tasks.append((sample_id, sample_config, sample_dir, dist))
    
    # C. 布局与处理（并行或串行）
    print("\n" + "=" * 60)
    print(f"步骤 C：布局与数据处理（{n_workers}进程）")
    print("=" * 60)
    
    total_start = time.time()
    
    if n_workers == 1:
        # 串行处理
        results = [process_sample_wrapper(task) for task in sample_tasks]
    else:
        # 并行处理
        with Pool(n_workers) as pool:
            results = pool.map(process_sample_wrapper, sample_tasks)
    
    total_elapsed = time.time() - total_start
    
    # 统计信息
    print("\n" + "=" * 60)
    print("生成完成统计")
    print("=" * 60)
    
    successful_results = [r for r in results if r['status'] == 'success']
    failed_results = [r for r in results if r['status'] == 'failed']
    
    total_time = sum(r['elapsed_seconds'] for r in results)
    avg_time = total_time / len(results) if results else 0
    throughput = len(successful_results) / total_elapsed if total_elapsed > 0 else 0
    
    print(f"总样本数: {len(results)}")
    print(f"成功: {len(successful_results)}")
    print(f"失败: {len(failed_results)}")
    print(f"总耗时: {total_elapsed:.2f} 秒")
    print(f"平均每样本: {avg_time:.2f} 秒")
    print(f"吞吐量: {throughput:.2f} 样本/秒")
    if n_workers > 1:
        speedup = total_time / total_elapsed if total_elapsed > 0 else 0
        print(f"并行加速比: {speedup:.2f}x")
    
    if failed_results:
        print(f"\n失败样本:")
        for r in failed_results:
            print(f"  - {r['sample_id']}: {r.get('error', 'Unknown error')}")
    
    # 保存元数据
    metadata = {
        'dataset': dist['dataset'],
        'generation': {
            'n_samples': len(results),
            'n_successful': len(successful_results),
            'n_failed': len(failed_results),
            'total_time_seconds': total_elapsed,
            'avg_time_per_sample': avg_time,
            'throughput_samples_per_sec': throughput,
            'parallel_workers': n_workers,
            'speedup': total_time / total_elapsed if n_workers > 1 and total_elapsed > 0 else 1.0
        },
        'samples': {r['sample_id']: r for r in results}
    }
    
    metadata_path = output_root / 'metadata.json'
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    print(f"\n元数据已保存: {metadata_path}")
    print(f"输出目录: {output_root}")
    print("=" * 60)


if __name__ == "__main__":
    main()

"""
FreeCAD Agent Loop 原型

核心循环:
    input_step + instruction  →  match prompt template  →  render FreeCAD script
                              →  run via freecadcmd     →  output modified step

本阶段不接入 LLM, 使用基于 keyword 匹配 + 正则参数抽取的简单解析器.

用法:
    python agent_loop.py --input in.step --output out.step \
        --instruction "整体 X 方向平移 10mm"

    python agent_loop.py --input in.step --output out.step \
        --template translate_all --params '{"dx":10,"dy":0,"dz":0}'
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: 需要 PyYAML", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = SCRIPT_DIR / "prompts"
TEMPLATE_FILE = SCRIPT_DIR / "templates" / "base_step_modify.py.tmpl"


# -------------------- Prompt 库加载 --------------------

def load_prompts():
    """加载 prompts/*.yaml 返回 {name: prompt_dict}"""
    prompts = {}
    for f in sorted(PROMPTS_DIR.glob("*.yaml")):
        with open(f, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if not data or "name" not in data or "code" not in data:
            continue
        prompts[data["name"]] = data
    return prompts


# -------------------- 指令解析 (占位简易版) --------------------

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _parse_numbers(text, n=3):
    """从指令文本中抽取前 n 个数字"""
    nums = [float(x) for x in _NUM_RE.findall(text)]
    return nums[:n]


def parse_instruction(instruction, prompts):
    """
    将自然语言指令解析为 (template_name, params) 元组.
    占位实现: 关键词匹配 + 简单数字抽取.
    返回 None 表示无法解析.
    """
    text = instruction.strip()
    text_lower = text.lower()

    # 匹配 identity / noop
    if any(kw in text_lower for kw in ["原样", "identity", "noop", "不修改"]):
        return "export_identity", {}

    # 匹配 translate_by_bbox
    if any(kw in text for kw in ["归零", "原点", "居中", "包围盒中心"]) or \
       "recenter" in text_lower:
        nums = _parse_numbers(text, 3)
        params = {
            "anchor_x": nums[0] if len(nums) > 0 else 0.0,
            "anchor_y": nums[1] if len(nums) > 1 else 0.0,
            "anchor_z": nums[2] if len(nums) > 2 else 0.0,
        }
        return "translate_by_bbox", params

    # 匹配 translate_all
    if any(kw in text for kw in ["平移", "整体偏移", "偏移", "移动"]) or \
       any(kw in text_lower for kw in ["translate", "shift"]):
        nums = _parse_numbers(text, 3)
        # 检测方向提示 (x/y/z + 单值)
        if len(nums) == 1:
            if "x" in text_lower:
                return "translate_all", {"dx": nums[0], "dy": 0.0, "dz": 0.0}
            if "y" in text_lower:
                return "translate_all", {"dx": 0.0, "dy": nums[0], "dz": 0.0}
            if "z" in text_lower:
                return "translate_all", {"dx": 0.0, "dy": 0.0, "dz": nums[0]}
        params = {
            "dx": nums[0] if len(nums) > 0 else 0.0,
            "dy": nums[1] if len(nums) > 1 else 0.0,
            "dz": nums[2] if len(nums) > 2 else 0.0,
        }
        return "translate_all", params

    # 匹配 scale_all
    if any(kw in text for kw in ["缩放", "放大", "缩小"]) or \
       "scale" in text_lower:
        nums = _parse_numbers(text, 1)
        factor = nums[0] if nums else 1.0
        return "scale_all", {"factor": factor}

    # 匹配 fillet
    if any(kw in text for kw in ["圆角", "倒圆"]) or \
       "fillet" in text_lower:
        nums = _parse_numbers(text, 1)
        radius = nums[0] if nums else 1.0
        return "fillet_all_edges", {"radius": radius}

    return None


# -------------------- 脚本渲染 & 执行 --------------------

def render_operation_code(prompt, params):
    """将 prompt['code'] 用 params 填充, 并缩进 4 空格以匹配模板"""
    try:
        body = prompt["code"].format(**params)
    except KeyError as exc:
        raise ValueError(f"缺少参数: {exc}") from exc
    # 每行前加 4 空格 (匹配模板内层缩进)
    lines = body.splitlines()
    indented = "\n".join(("    " + ln) if ln.strip() else ln for ln in lines)
    return indented


def render_script(input_step, output_step, operation_code):
    """将模板填充生成可执行的 Python 脚本"""
    with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
        tpl = f.read()
    script = tpl.replace("__INPUT_STEP__", repr(str(input_step)))
    script = script.replace("__OUTPUT_STEP__", repr(str(output_step)))
    script = script.replace("__OPERATION_CODE__", operation_code)
    return script


def run_freecad_script(script_content, workdir=None):
    """将脚本写入临时文件并用 freecadcmd 执行, 返回 (returncode, stdout, stderr, script_path)"""
    workdir = Path(workdir) if workdir else Path("/tmp")
    workdir.mkdir(parents=True, exist_ok=True)
    script_path = workdir / "agent_generated.py"
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script_content)
    freecadcmd = os.environ.get("FREECADCMD", "freecadcmd")
    proc = subprocess.run(
        [freecadcmd, str(script_path)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    return proc.returncode, proc.stdout, proc.stderr, str(script_path)


# -------------------- 主流程 --------------------

def run_agent_loop(
    input_step,
    output_step,
    instruction=None,
    template_name=None,
    params=None,
    workdir=None,
    script_out=None,
):
    """
    主调用入口.

    参数优先级: (template_name + params) > instruction
    返回 dict 包含 success, template, params, output_size 等.
    """
    input_step = Path(input_step)
    output_step = Path(output_step)
    output_step.parent.mkdir(parents=True, exist_ok=True)

    prompts = load_prompts()

    # 选定模板和参数
    if template_name is None:
        if instruction is None:
            raise ValueError("必须指定 instruction 或 template_name")
        parsed = parse_instruction(instruction, prompts)
        if parsed is None:
            return {
                "success": False,
                "error": f"无法解析指令: {instruction!r}",
                "available_templates": list(prompts.keys()),
            }
        template_name, params = parsed

    if template_name not in prompts:
        return {
            "success": False,
            "error": f"未知模板: {template_name}",
            "available_templates": list(prompts.keys()),
        }
    params = dict(params or {})

    # 填充默认参数
    prompt = prompts[template_name]
    for pname, pmeta in (prompt.get("parameters") or {}).items():
        if pname not in params and "default" in pmeta:
            params[pname] = pmeta["default"]

    # 渲染
    operation_code = render_operation_code(prompt, params)
    script = render_script(input_step, output_step, operation_code)

    # 审计: 把渲染后的脚本写到 script_out (若指定)
    if script_out:
        script_out = Path(script_out)
        script_out.parent.mkdir(parents=True, exist_ok=True)
        script_out.write_text(script, encoding="utf-8")

    # 执行
    rc, out, err, script_path = run_freecad_script(script, workdir)

    result = {
        "success": rc == 0 and output_step.exists(),
        "returncode": rc,
        "template": template_name,
        "params": params,
        "instruction": instruction,
        "stdout": out,
        "stderr": err,
        "script_path": script_path,
        "input_step": str(input_step),
        "output_step": str(output_step),
    }
    if script_out:
        result["script_out"] = str(script_out)
    if result["success"]:
        result["output_size"] = output_step.stat().st_size
    return result


def main():
    parser = argparse.ArgumentParser(
        description="FreeCAD Agent Loop (STEP → 修改 → STEP)")
    parser.add_argument("--input", help="输入 STEP 路径")
    parser.add_argument("--output", help="输出 STEP 路径")
    parser.add_argument("--instruction", type=str, default=None,
                        help="自然语言指令")
    parser.add_argument("--template", type=str, default=None,
                        help="直接指定模板名 (跳过解析)")
    parser.add_argument("--params", type=str, default=None,
                        help="JSON 格式的模板参数")
    parser.add_argument("--workdir", type=str, default=None,
                        help="临时工作目录 (默认 /tmp)")
    parser.add_argument("--script-out", type=str, default=None,
                        help="把渲染后的 FreeCAD 脚本保存到此路径 (审计用)")
    parser.add_argument("--result-out", type=str, default=None,
                        help="把完整结果 JSON 保存到此路径 (供 orchestrator 读)")
    parser.add_argument("--list-templates", action="store_true",
                        help="列出所有可用模板")
    args = parser.parse_args()

    if args.list_templates:
        prompts = load_prompts()
        for name, data in prompts.items():
            desc = data.get("description", "").strip().splitlines()
            print(f"- {name}: {desc[0] if desc else ''}")
        return

    if not args.input or not args.output:
        parser.error("--input 和 --output 为必需参数 (除非使用 --list-templates)")

    params = json.loads(args.params) if args.params else None

    result = run_agent_loop(
        args.input,
        args.output,
        instruction=args.instruction,
        template_name=args.template,
        params=params,
        workdir=args.workdir,
        script_out=args.script_out,
    )
    if args.result_out:
        ro = Path(args.result_out)
        ro.parent.mkdir(parents=True, exist_ok=True)
        ro.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()

import json
import sys
from pathlib import Path

import FreeCAD
import Import
import ImportGui

DOC_NAME = __DOC_NAME__
UPDATES = __UPDATES__
RECOMPUTE = __RECOMPUTE__
EXPORT_STEP_PATH = __EXPORT_STEP_PATH__
def vec(v):
    return [float(v.x), float(v.y), float(v.z)]


__PLACEMENT_HELPERS__


def placement_payload(placement):
    return {
        "base": vec(placement.Base),
        "rotation_quaternion": [
            float(placement.Rotation.Q[0]),
            float(placement.Rotation.Q[1]),
            float(placement.Rotation.Q[2]),
            float(placement.Rotation.Q[3]),
        ],
    }


def apply_delta_placement(target_placement, source_placement, current_placement):
    delta = target_placement.multiply(source_placement.inverse())
    return delta.multiply(current_placement)


def export_step_and_glb(objects, step_path):
    step_path = str(Path(step_path))
    Path(step_path).parent.mkdir(parents=True, exist_ok=True)
    glb_path = str(Path(step_path).with_suffix(".glb"))

    Import.export(objects, step_path)

    export_options = None
    if hasattr(ImportGui, "exportOptions"):
        try:
            export_options = ImportGui.exportOptions("glTF")
        except Exception:
            export_options = None

    if export_options is None:
        ImportGui.export(objects, glb_path)
    else:
        try:
            ImportGui.export(objects, glb_path, export_options)
        except TypeError:
            ImportGui.export(objects, glb_path)

    return step_path, glb_path


def top_level_export_objects(doc):
    ignored_names = {"Origin", "X_Axis", "Y_Axis", "Z_Axis", "XY_Plane", "XZ_Plane", "YZ_Plane"}
    roots = []
    for obj in getattr(doc, "Objects", []):
        if getattr(obj, "InList", []):
            continue
        if getattr(obj, "TypeId", "") == "App::Origin":
            continue
        if getattr(obj, "Name", "") in ignored_names:
            continue
        roots.append(obj)
    return roots


def find_export_objects(doc):
    for obj in getattr(doc, "Objects", []):
        type_id = getattr(obj, "TypeId", "")
        if type_id not in ("Assembly::AssemblyObject", "App::Part"):
            continue
        if getattr(obj, "InList", []):
            continue
        if getattr(obj, "Name", "") == "Assembly" or getattr(obj, "Label", "") == "Assembly":
            return [obj], "assembly_root"

    roots = top_level_export_objects(doc)
    if roots:
        return roots, "top_level"
    return [], "none"


try:
    doc = FreeCAD.getDocument(DOC_NAME)
    if doc is None:
        raise RuntimeError(f"document not found: {DOC_NAME}")

    applied = []
    total_updates = max(len(UPDATES), 1)
    for index, update in enumerate(UPDATES, start=1):
        component_id = update["component"]
        part_placement = make_placement(update["position"], update["orientation_rows"])
        has_source_placement = "source_position" in update and "source_orientation_rows" in update
        source_placement = (
            make_placement(update["source_position"], update["source_orientation_rows"])
            if has_source_placement
            else None
        )
        solid_placement = make_placement(
            update.get("solid_position", update["position"]),
            update.get("solid_orientation_rows", update["orientation_rows"]),
        )
        solid_name = update.get("solid_name")
        part_name = update.get("part_name")
        solid = doc.getObject(solid_name) if solid_name else None
        part = doc.getObject(part_name) if part_name else None

        if solid is None and part is None:
            raise RuntimeError(
                f"component '{component_id}' missing from document '{DOC_NAME}' "
                f"(solid='{solid_name}', part='{part_name}')"
            )

        placements = []
        if part is not None and has_source_placement:
            old = part.Placement
            part.Placement = apply_delta_placement(
                part_placement,
                source_placement,
                old,
            )
            placements.append(
                {
                    "object": part.Name,
                    "old_placement": placement_payload(old),
                    "new_placement": placement_payload(part.Placement),
                    "mode": "delta",
                }
            )
        elif solid is not None:
            old = solid.Placement
            solid.Placement = solid_placement
            placements.append(
                {
                    "object": solid.Name,
                    "old_placement": placement_payload(old),
                    "new_placement": placement_payload(solid.Placement),
                    "mode": "absolute",
                }
            )

        if part is not None and not has_source_placement:
            old = part.Placement
            if solid is not None:
                part.Placement = FreeCAD.Placement()
            else:
                part.Placement = part_placement
            placements.append(
                {
                    "object": part.Name,
                    "old_placement": placement_payload(old),
                    "new_placement": placement_payload(part.Placement),
                    "mode": "absolute",
                }
            )

        applied.append({"component": component_id, "updates": placements})

    exported_step_path = None
    exported_glb_path = None
    export_mode = None
    exported_object_names = []

    performed_recompute = bool(RECOMPUTE or EXPORT_STEP_PATH)
    if performed_recompute:
        doc.recompute()
    
    if EXPORT_STEP_PATH:
        export_objects, export_mode = find_export_objects(doc)
        if not export_objects:
            raise RuntimeError(
                f"document '{DOC_NAME}' does not contain any exportable top-level objects"
            )
        exported_object_names = [obj.Name for obj in export_objects]
        exported_step_path, exported_glb_path = export_step_and_glb(
            export_objects,
            EXPORT_STEP_PATH,
        )

    print(
        json.dumps(
            {
                "success": True,
                "document": DOC_NAME,
                "component_count": len(applied),
                "components": applied,
                "recomputed": performed_recompute,
                "step_path": exported_step_path,
                "glb_path": exported_glb_path,
                "export_mode": export_mode,
                "exported_objects": exported_object_names,
            }
        )
    )
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
    sys.exit(1)

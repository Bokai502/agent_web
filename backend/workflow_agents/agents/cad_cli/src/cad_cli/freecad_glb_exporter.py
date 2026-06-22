"""Low-complexity hybrid-link GLB exporter for FreeCAD RPC."""

from __future__ import annotations

import json
import math
import struct
import time
from pathlib import Path

import MeshPart
import Part

from freecad_runtime import object_shape_or_none


COMPONENT_GLB_LINEAR_DEFLECTION = 12.0
COMPONENT_GLB_ANGULAR_DEFLECTION = 0.75
COMPONENT_GLB_MAX_VERTICES = 25000


def _align4(value):
    return (int(value) + 3) & ~3


def _pack_f32(values):
    pack = struct.Struct("<f").pack
    out = bytearray()
    for value in values:
        out += pack(float(value))
    return bytes(out)


def _pack_u16(values):
    pack = struct.Struct("<H").pack
    out = bytearray()
    for value in values:
        out += pack(int(value))
    return bytes(out)


def _base_id(value):
    text = str(value or "")
    if text.startswith("P") and len(text) >= 4 and text[1:4].isdigit():
        return text[:4]
    return text


def _normalized_id(value):
    return _base_id(value)


def _mesh_normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / length, ny / length, nz / length)


def _minmax_vec3(values):
    if not values:
        return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
    return [min(v[i] for v in values) for i in range(3)], [max(v[i] for v in values) for i in range(3)]


def _freecad_point_to_gltf(point):
    return (float(point[0]) / 1000.0, float(point[2]) / 1000.0, -float(point[1]) / 1000.0)


def _freecad_normal_to_gltf(normal):
    return (float(normal[0]), float(normal[2]), -float(normal[1]))


def _shape_copy_for_mesh(obj):
    shape = object_shape_or_none(obj)
    if shape is None:
        return None
    copied = shape.copy()
    try:
        copied.Placement = obj.getGlobalPlacement()
    except Exception:
        pass
    return copied


def _mesh_shape_to_chunks(shape, max_vertices=COMPONENT_GLB_MAX_VERTICES):
    mesh = MeshPart.meshFromShape(
        Shape=shape,
        LinearDeflection=COMPONENT_GLB_LINEAR_DEFLECTION,
        AngularDeflection=COMPONENT_GLB_ANGULAR_DEFLECTION,
        Relative=False,
    )
    points, facets = mesh.Topology
    points = [(float(p.x), float(p.y), float(p.z)) for p in points]
    facets = [tuple(int(i) for i in f) for f in facets]
    chunks = []
    remap = {}
    vertices = []
    normals_acc = []
    indices = []

    def flush():
        nonlocal remap, vertices, normals_acc, indices
        if not vertices or not indices:
            remap = {}
            vertices = []
            normals_acc = []
            indices = []
            return
        normals = []
        for nx, ny, nz in normals_acc:
            length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            normals.append((nx / length, ny / length, nz / length))
        chunks.append((vertices, normals, indices))
        remap = {}
        vertices = []
        normals_acc = []
        indices = []

    def add_vertex(old_idx, normal):
        nonlocal remap, vertices, normals_acc
        new_idx = remap.get(old_idx)
        if new_idx is None:
            new_idx = len(vertices)
            remap[old_idx] = new_idx
            vertices.append(points[old_idx])
            normals_acc.append([0.0, 0.0, 0.0])
        normals_acc[new_idx][0] += normal[0]
        normals_acc[new_idx][1] += normal[1]
        normals_acc[new_idx][2] += normal[2]
        return new_idx

    for facet in facets:
        if len(remap) + 3 > max_vertices:
            flush()
        a, b, c = points[facet[0]], points[facet[1]], points[facet[2]]
        normal = _mesh_normal(a, b, c)
        indices.extend([
            add_vertex(facet[0], normal),
            add_vertex(facet[1], normal),
            add_vertex(facet[2], normal),
        ])
    flush()
    return chunks, len(points), len(facets)


def _rgba_from_object(obj, fallback=(0.65, 0.68, 0.70, 1.0)):
    try:
        color = obj.ViewObject.ShapeColor
        alpha = 1.0 - (float(getattr(obj.ViewObject, "Transparency", 0) or 0.0) / 100.0)
        return [float(color[0]), float(color[1]), float(color[2]), max(0.05, min(1.0, alpha))]
    except Exception:
        return list(fallback)


def _rgba_from_component_data(components, component_id, fallback=None):
    if fallback is None:
        fallback = (0.65, 0.68, 0.70, 1.0)
    component = {}
    if isinstance(components, dict):
        component = components.get(component_id) or components.get(_normalized_id(component_id)) or {}
    color = component.get("color") if isinstance(component, dict) else None
    if not isinstance(color, list) or len(color) < 3:
        return list(fallback)
    rgba = []
    for value in color[:4]:
        try:
            parsed = max(0.0, min(255.0, float(value))) / 255.0
        except Exception:
            parsed = 1.0
        rgba.append(parsed)
    while len(rgba) < 4:
        rgba.append(1.0)
    return rgba


def _component_name_for_glb(obj):
    try:
        component_id = str(getattr(obj, "ComponentID", "") or "")
        if component_id.startswith("P") and len(component_id) >= 4 and component_id[1:4].isdigit():
            return component_id[:4]
    except Exception:
        pass
    label = str(getattr(obj, "Label", "") or "")
    name = str(getattr(obj, "Name", "") or "")
    for value in (label, name):
        if value == "Envelope_part" or value == "EnvelopeShell":
            return "EnvelopeShell"
        if value.startswith("P") and len(value) >= 4 and value[1:4].isdigit():
            return value[:4]
        if value.endswith("_part") and value.startswith("P") and value[1:4].isdigit():
            return value[:4]
        if "__" in value and value.startswith("P") and value[1:4].isdigit():
            return value[:4]
    return _base_id(name) or label or name


def _iter_descendant_shapes(container):
    stack = list(getattr(container, "Group", []) or [])
    while stack:
        obj = stack.pop()
        if obj is None:
            continue
        if obj.TypeId == "App::Part":
            stack.extend(getattr(obj, "Group", []) or [])
            continue
        if object_shape_or_none(obj) is None:
            continue
        yield obj


def _collect_component_glb_shapes(export_parts):
    items = []
    for obj in export_parts:
        if obj is None:
            continue
        name = _component_name_for_glb(obj)
        if name.startswith("LinkedSTEPGroup_") or name.startswith("LinkedSTEPGroup__"):
            for child in list(getattr(obj, "Group", []) or []):
                shape = _shape_copy_for_mesh(child)
                if shape is not None:
                    items.append((_component_name_for_glb(child), child, shape))
            continue
        if obj.TypeId == "App::Part" and name not in ("EnvelopeShell", "Envelope_part"):
            shapes = []
            for child in list(_iter_descendant_shapes(obj)):
                child_shape = _shape_copy_for_mesh(child)
                if child_shape is not None:
                    shapes.append(child_shape)
            if shapes:
                shape = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
                items.append((name, obj, shape))
                continue
        shape = _shape_copy_for_mesh(obj)
        if shape is not None:
            items.append((name, obj, shape))
    return items


def export_component_node_glb(export_parts, glb_path, components=None):
    started = time.monotonic()
    glb_path = Path(glb_path)
    items = _collect_component_glb_shapes(export_parts)
    binout = bytearray()
    buffer_views = []
    accessors = []
    materials = []
    material_by_rgba = {}
    meshes = []
    nodes = [{"name": "SceneRoot", "children": []}]
    component_summaries = []

    def material_index(obj, name):
        rgba = _rgba_from_component_data(components or {}, name, _rgba_from_object(obj))
        if name == "EnvelopeShell":
            rgba = [0.35, 0.55, 1.0, 0.20]
        key = tuple(round(float(v), 4) for v in rgba)
        if key not in material_by_rgba:
            material = {
                "name": f"mat_{len(materials)}",
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(key),
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.65,
                },
                "doubleSided": True,
            }
            if key[3] < 0.999:
                material["alphaMode"] = "BLEND"
            material_by_rgba[key] = len(materials)
            materials.append(material)
        return material_by_rgba[key]

    for name, obj, shape in items:
        try:
            chunks, mesh_points, mesh_triangles = _mesh_shape_to_chunks(shape)
        except Exception as exc:
            component_summaries.append({"name": name, "mesh_error": str(exc)})
            continue
        primitives = []
        mat_idx = material_index(obj, name)
        total_vertices = 0
        total_triangles = 0
        for vertices, normals, indices in chunks:
            if not vertices or not indices:
                continue
            gltf_vertices = [_freecad_point_to_gltf(vertex) for vertex in vertices]
            gltf_normals = [_freecad_normal_to_gltf(normal) for normal in normals]
            pos_min, pos_max = _minmax_vec3(gltf_vertices)
            pos_off = len(binout)
            pos_bytes = _pack_f32([value for vertex in gltf_vertices for value in vertex])
            binout += pos_bytes
            while len(binout) % 4:
                binout.append(0)
            norm_off = len(binout)
            norm_bytes = _pack_f32([value for normal in gltf_normals for value in normal])
            binout += norm_bytes
            while len(binout) % 4:
                binout.append(0)
            idx_off = len(binout)
            idx_bytes = _pack_u16(indices)
            binout += idx_bytes
            while len(binout) % 4:
                binout.append(0)
            bv_pos = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_bytes), "byteStride": 12, "target": 34962})
            bv_norm = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": norm_off, "byteLength": len(norm_bytes), "byteStride": 12, "target": 34962})
            bv_idx = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_bytes), "target": 34963})
            acc_pos = len(accessors)
            accessors.append({"bufferView": bv_pos, "componentType": 5126, "count": len(vertices), "type": "VEC3", "min": pos_min, "max": pos_max})
            acc_norm = len(accessors)
            accessors.append({"bufferView": bv_norm, "componentType": 5126, "count": len(normals), "type": "VEC3"})
            acc_idx = len(accessors)
            accessors.append({"bufferView": bv_idx, "componentType": 5123, "count": len(indices), "type": "SCALAR", "min": [0], "max": [len(vertices) - 1]})
            primitives.append({"attributes": {"POSITION": acc_pos, "NORMAL": acc_norm}, "indices": acc_idx, "mode": 4, "material": mat_idx})
            total_vertices += len(vertices)
            total_triangles += len(indices) // 3
        if not primitives:
            continue
        mesh_index = len(meshes)
        meshes.append({"name": f"{name}_mesh", "primitives": primitives})
        node_index = len(nodes)
        nodes.append({"name": name, "mesh": mesh_index, "extras": {"component_id": name if name.startswith("P") else None}})
        nodes[0]["children"].append(node_index)
        component_summaries.append({
            "name": name,
            "primitive_count": len(primitives),
            "vertices": total_vertices,
            "triangles": total_triangles,
            "source_mesh_points": mesh_points,
            "source_mesh_triangles": mesh_triangles,
        })

    gltf = {
        "asset": {"version": "2.0", "generator": "hybrid App::Link component-node low-complexity GLB exporter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials or [{"name": "default"}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(binout)}],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = _align4(len(json_bytes)) - len(json_bytes)
    bin_pad = _align4(len(binout)) - len(binout)
    total = 12 + 8 + len(json_bytes) + json_pad + 8 + len(binout) + bin_pad
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    out += struct.pack("<I4s", len(json_bytes) + json_pad, b"JSON") + json_bytes + b" " * json_pad
    out += struct.pack("<I4s", len(binout) + bin_pad, b"BIN\x00") + binout + b"\0" * bin_pad
    glb_path.write_bytes(out)
    return {
        "glb_path": str(glb_path),
        "glb_size_bytes": glb_path.stat().st_size,
        "node_count": len(nodes),
        "mesh_count": len(meshes),
        "material_count": len(materials),
        "accessor_count": len(accessors),
        "buffer_view_count": len(buffer_views),
        "component_count": len(component_summaries),
        "component_summaries": component_summaries,
        "linear_deflection": COMPONENT_GLB_LINEAR_DEFLECTION,
        "angular_deflection": COMPONENT_GLB_ANGULAR_DEFLECTION,
        "max_vertices_per_primitive": COMPONENT_GLB_MAX_VERTICES,
        "export_seconds": time.monotonic() - started,
    }

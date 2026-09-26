"""Build the FR-26 car procedurally in Blender and export it as a GLB.

Run through tools/export-car.ts, which passes the paths after "--". Wheel positions,
tyre radius and the collision box come from the physics car definition and the node
names from content/cars/model-interface.json, so the model cannot drift from either.

Geometry is written in the game's chassis frame (+z forward, +y up, driver's right -x,
origin at the chassis collider centre) and converted to Blender's Z-up frame on the way
in; the glTF exporter's +Y-up conversion then restores the game frame exactly.
"""

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy


def B(p):
    """Game frame to Blender frame."""
    x, y, z = p
    return (x, -z, y)


# --- materials --------------------------------------------------------------------------


def material(name, colour, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    shader = m.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return m


def add_bump(m, pattern, strength):
    """Procedural surface detail that only exists to be baked into the normal map."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    coord = nodes.new("ShaderNodeTexCoord")
    if pattern == "panels":
        tex = nodes.new("ShaderNodeTexWave")
        tex.wave_type = "BANDS"
        tex.bands_direction = "Y"
        tex.inputs["Scale"].default_value = 1.6
        tex.inputs["Distortion"].default_value = 0.0
        tex.inputs["Detail"].default_value = 0.0
    else:
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 60.0
        tex.inputs["Detail"].default_value = 4.0
    links.new(coord.outputs["Object"], tex.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.name = "bake_bump"
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.002
    links.new(tex.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], nodes["Principled BSDF"].inputs["Normal"])


# --- geometry helpers (game frame) --------------------------------------------------------


def mesh_object(name, verts, faces, mat, parent=None, location=(0, 0, 0), face_mats=None):
    """`mat` is one material, or a list indexed by `face_mats`."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bverts = [bm.verts.new(B(v)) for v in verts]
    for i, f in enumerate(faces):
        face = bm.faces.new([bverts[k] for k in f])
        face.material_index = face_mats[i] if face_mats else 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for m in mat if isinstance(mat, list) else [] if mat is None else [mat]:
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = B(location)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, location, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = B(location)
    if parent is not None:
        obj.parent = parent
    return obj


def catmull_rom(points, steps):
    """Smoothly interpolates each parameter of a list of tuples, through every point."""
    out = []
    n = len(points)
    for i in range(n - 1):
        p0, p1, p2, p3 = (points[max(i - 1, 0)], points[i], points[i + 1], points[min(i + 2, n - 1)])
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5
                    * (
                        2 * b
                        + (-a + c) * t
                        + (2 * a - 5 * b + 4 * c - d) * t2
                        + (-a + 3 * b - 3 * c + d) * t3
                    )
                    for a, b, c, d in zip(p0, p1, p2, p3)
                )
            )
    out.append(points[-1])
    return out


def loft(name, sections, mat, ring=40, steps=6, exponent=2.6):
    """A closed body through (z, cx, cy, half_width, half_height) sections, front to rear."""
    rows = catmull_rom(sections, steps)
    verts, faces = [], []
    for z, cx, cy, hw, hh in rows:
        for k in range(ring):
            a = 2 * math.pi * k / ring
            c, s = math.cos(a), math.sin(a)
            x = cx + hw * math.copysign(abs(c) ** (2 / exponent), c)
            y = cy + hh * math.copysign(abs(s) ** (2 / exponent), s)
            verts.append((x, y, z))
    for r in range(len(rows) - 1):
        for k in range(ring):
            a, b = r * ring + k, r * ring + (k + 1) % ring
            faces.append((a, b, b + ring, a + ring))
    for r, row in ((0, rows[0]), (len(rows) - 1, rows[-1])):
        verts.append((row[1], row[2], row[0]))
        pole = len(verts) - 1
        for k in range(ring):
            faces.append((r * ring + k, r * ring + (k + 1) % ring, pole))
    return mesh_object(name, verts, faces, mat)


def tube(name, points, radius, mat, sides=10):
    """A capped tube along a polyline, using parallel-transport frames so it never twists."""
    import mathutils

    pts = [mathutils.Vector(p) for p in points]
    tangents = []
    for i in range(len(pts)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        tangents.append((b - a).normalized())
    normal = tangents[0].orthogonal().normalized()
    verts, faces = [], []
    for i, p in enumerate(pts):
        if i > 0:
            normal = (normal - tangents[i] * normal.dot(tangents[i])).normalized()
        binormal = tangents[i].cross(normal)
        for k in range(sides):
            a = 2 * math.pi * k / sides
            v = p + (normal * math.cos(a) + binormal * math.sin(a)) * radius
            verts.append(tuple(v))
    for i in range(len(pts) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(range(sides)))
    faces.append(tuple(range((len(pts) - 1) * sides, len(pts) * sides)))
    return mesh_object(name, verts, faces, mat)


def box(name, centre, half, mat):
    cx, cy, cz = centre
    hx, hy, hz = half
    verts = [
        (cx + sx * hx, cy + sy * hy, cz + sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)
    ]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_object(name, verts, faces, mat)


def airfoil(name, half_span, chord, thickness, camber, angle, mat, profile=16, span=12, origin=(0, 0, 0)):
    """A wing whose leading edge lies along x at `origin`, chord running rearward (-z).

    Camber is negative for downforce. `angle` raises the trailing edge (radians).
    """
    ox, oy, oz = origin
    upper, lower = [], []
    for i in range(profile + 1):
        u = (1 - math.cos(math.pi * i / profile)) / 2  # cosine spacing packs the nose
        yt = 5 * thickness * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u**2 + 0.2843 * u**3 - 0.1036 * u**4)
        yc = camber * 4 * u * (1 - u)
        upper.append((u, yc + yt))
        lower.append((u, yc - yt))
    loop = upper + lower[-2:0:-1]
    ca, sa = math.cos(angle), math.sin(angle)
    verts, faces = [], []
    for j in range(span + 1):
        x = -half_span + 2 * half_span * j / span
        for u, y in loop:
            y0, z0 = y * chord, -u * chord
            verts.append((ox + x, oy + y0 * ca - z0 * sa, oz + y0 * sa + z0 * ca))
    n = len(loop)
    for j in range(span):
        for k in range(n):
            a, b = j * n + k, j * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.append(tuple(range(n)))
    faces.append(tuple(range(span * n, (span + 1) * n)))
    return mesh_object(name, verts, faces, mat)


def lathe(name, profile, segments, mats, parent):
    """Surfaces of revolution about the local x axis; `profile` is [(material index, [(x, r)])]."""
    verts, faces, face_mats = [], [], []
    for index, points in profile:
        base = len(verts)
        for k in range(segments):
            a = 2 * math.pi * k / segments
            for x, r in points:
                verts.append((x, r * math.cos(a), r * math.sin(a)))
        m = len(points)
        for k in range(segments):
            for i in range(m - 1):
                a = base + k * m + i
                b = base + ((k + 1) % segments) * m + i
                faces.append((a, b, b + 1, a + 1))
                face_mats.append(index)
    return mesh_object(name, verts, faces, mats, parent=parent, face_mats=face_mats)


# --- the car ------------------------------------------------------------------------------


def build(car, spec, textures):
    w = car["wheels"]
    ground = w["connectionY"] - w["suspensionRestLength"] - w["radius"]
    G = lambda h: ground + h  # height above the ground

    paint = material("paint", (0.70, 0.05, 0.03), 0.3, 0.35)
    # Liveries recolour `paint` and `accent` (content/cars/liveries.json).
    accent = material("accent", (0.89, 0.89, 0.89), 0.2, 0.35)
    carbon = material("carbon", (0.025, 0.025, 0.028), 0.1, 0.45)
    halo_metal = material("titanium", (0.55, 0.56, 0.58), 0.8, 0.35)
    helmet = material("helmet", (0.95, 0.78, 0.10), 0.0, 0.3)
    rubber = material("tyre", (0.03, 0.03, 0.03), 0.0, 0.9)
    rim = material("rim", (0.12, 0.12, 0.13), 0.9, 0.3)
    add_bump(paint, "panels", 0.15)
    add_bump(carbon, "noise", 0.08)
    add_bump(accent, "panels", 0.15)
    add_bump(halo_metal, "noise", 0.05)
    add_bump(helmet, "noise", 0.02)

    parts = []
    # Survival cell and nose.
    parts.append(
        loft(
            "monocoque",
            [
                (2.62, 0, G(0.24), 0.06, 0.05),
                (2.20, 0, G(0.30), 0.11, 0.09),
                (1.70, 0, G(0.36), 0.16, 0.13),
                (1.20, 0, G(0.40), 0.24, 0.18),
                (0.80, 0, G(0.40), 0.33, 0.22),
                (0.20, 0, G(0.38), 0.40, 0.22),
                (-0.30, 0, G(0.42), 0.36, 0.30),
                (-0.90, 0, G(0.38), 0.26, 0.22),
                (-1.50, 0, G(0.32), 0.16, 0.14),
                (-2.00, 0, G(0.28), 0.08, 0.08),
            ],
            paint,
            ring=48,
            steps=6,
        )
    )
    # Airbox and engine cover above the roll hoop.
    parts.append(
        loft(
            "airbox",
            [
                (-0.05, 0, G(0.82), 0.10, 0.10),
                (-0.35, 0, G(0.76), 0.13, 0.16),
                (-0.90, 0, G(0.57), 0.10, 0.12),
                (-1.35, 0, G(0.42), 0.06, 0.06),
            ],
            paint,
            ring=32,
            steps=6,
        )
    )
    for side in (1, -1):
        parts.append(
            loft(
                f"sidepod_{'L' if side > 0 else 'R'}",
                [
                    (0.62, side * 0.50, G(0.25), 0.16, 0.15),
                    (0.15, side * 0.50, G(0.24), 0.24, 0.17),
                    (-0.60, side * 0.42, G(0.20), 0.20, 0.12),
                    (-1.25, side * 0.28, G(0.14), 0.10, 0.06),
                ],
                paint,
                ring=32,
                steps=6,
                exponent=3.6,
            )
        )
        # Mirrors on short stalks.
        parts.append(box(f"mirror_{side}", (side * 0.46, G(0.56), 0.62), (0.07, 0.03, 0.02), accent))
        parts.append(tube(f"mirror_stalk_{side}", [(side * 0.36, G(0.44), 0.62), (side * 0.44, G(0.55), 0.62)], 0.01, carbon, 6))

    # Floor with a tapered diffuser section.
    outline = [(0.70, 1.25), (0.70, -1.35), (0.50, -1.75), (-0.50, -1.75), (-0.70, -1.35), (-0.70, 1.25)]
    bottom, top = G(0.035), G(0.065)
    floor_verts = [(x, bottom, z) for x, z in outline] + [(x, top, z) for x, z in outline]
    n = len(outline)
    floor_faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    floor_faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    parts.append(mesh_object("floor", floor_verts, floor_faces, carbon))

    # Front wing: main plane, nose pylons and endplates; the flap is its own pivot.
    parts.append(airfoil("front_main", 0.90, 0.30, 0.08, -0.03, 0.02, carbon, origin=(0, G(0.10), 2.74)))
    for side in (1, -1):
        parts.append(box(f"front_endplate_{side}", (side * 0.90, G(0.17), 2.54), (0.01, 0.11, 0.24), accent))
        parts.append(box(f"front_pylon_{side}", (side * 0.08, G(0.18), 2.50), (0.01, 0.07, 0.06), carbon))

    # Rear wing: main plane, beam wing, endplates and a swan-neck pylon.
    parts.append(airfoil("rear_main", 0.50, 0.30, 0.10, -0.04, 0.05, carbon, origin=(0, G(0.73), -2.05)))
    parts.append(airfoil("beam_wing", 0.45, 0.22, 0.10, -0.02, 0.1, carbon, origin=(0, G(0.36), -1.98)))
    for side in (1, -1):
        parts.append(box(f"rear_endplate_{side}", (side * 0.50, G(0.70), -2.22), (0.01, 0.25, 0.22), accent))
    parts.append(tube("swan_neck", [(0, G(0.40), -1.60), (0, G(0.62), -1.90), (0, G(0.80), -2.12)], 0.02, carbon, 8))

    # Wishbones from the chassis to each hub.
    hub_y = w["connectionY"] - w["suspensionRestLength"]
    for axle, z in (("front", w["frontAxleZ"]), ("rear", w["rearAxleZ"])):
        inboard = 0.15 if axle == "front" else 0.14
        for side in (1, -1):
            hub_x = side * (w["halfTrack"] - 0.16)
            for dy, r in ((0.10, 0.018), (-0.10, 0.018)):
                y_in = hub_y + dy + (0.04 if dy > 0 else 0.02)
                for dz in (0.22, -0.22):
                    parts.append(
                        tube(f"arm_{axle}_{side}_{dy}_{dz}", [(side * inboard, y_in, z + dz), (hub_x, hub_y + dy, z)], r, carbon, 6)
                    )

    # Halo around the cockpit, and the driver's helmet.
    halo_centre_z = 0.36
    loop_pts = [(0.30 * -1, G(0.54), -0.02), (-0.28, G(0.68), 0.10)]
    for i in range(1, 12):
        t = -math.pi / 2 + math.pi * i / 12
        loop_pts.append((0.26 * math.sin(t), G(0.72), halo_centre_z + 0.38 * math.cos(t)))
    loop_pts += [(0.28, G(0.68), 0.10), (0.30, G(0.54), -0.02)]
    parts.append(tube("halo", loop_pts, 0.022, halo_metal, 10))
    parts.append(tube("halo_pillar", [(0, G(0.53), 0.90), (0, G(0.63), 0.84), (0, G(0.72), 0.74)], 0.02, halo_metal, 10))
    parts.append(loft("helmet", [(0.30, 0, G(0.66), 0.001, 0.001), (0.25, 0, G(0.66), 0.09, 0.10), (0.15, 0, G(0.67), 0.12, 0.13), (0.03, 0, G(0.67), 0.11, 0.12), (-0.02, 0, G(0.66), 0.001, 0.001)], helmet, ring=24, steps=4, exponent=2.0))

    body = empty(spec["body"], (0, 0, 0))
    lod0 = join(parts, lod_name(spec["body"], 0))
    lod0.parent = body

    # Wheels: pivots at the physics hubs, rim face outward on each side.
    wheels = []
    hubs = [
        (w["halfTrack"], w["frontAxleZ"], 0.28),
        (-w["halfTrack"], w["frontAxleZ"], 0.28),
        (w["halfTrack"], w["rearAxleZ"], 0.29),
        (-w["halfTrack"], w["rearAxleZ"], 0.29),
    ]
    for name, (x, z, width) in zip(spec["wheels"], hubs):
        pivot = empty(name, (x, hub_y, z))
        outward = 1 if x > 0 else -1
        for level, segments in enumerate((48, 24, 12)):
            wheel(lod_name(name, level), pivot, w["radius"], width, outward, segments, level, rubber, rim)
        wheels.append(pivot)

    # Flaps hinge at their leading edge so the renderer can rotate them for Straight Mode.
    flap_defs = [
        (spec["flaps"][0], (0, G(0.135), 2.46), 0.85, 0.20, 0.35),
        (spec["flaps"][1], (0, G(0.80), -2.26), 0.49, 0.18, 0.55),
    ]
    for name, hinge, half_span, chord, angle in flap_defs:
        pivot = empty(name, hinge)
        for level, (profile, span) in enumerate(((16, 12), (8, 3), (3, 1))):
            obj = airfoil(lod_name(name, level), half_span, chord, 0.08, -0.02, angle, carbon, profile, span)
            obj.parent = pivot

    for name, position in zip(spec["anchors"], [(0, G(1.05), -0.6), (0, G(0.72), 0.30)]):
        empty(name, position)

    h = car["chassisHalfExtents"]
    box(spec["collision"], (0, 0, 0), (h["x"], h["y"], h["z"]), None)

    return body, lod0, [paint, accent, carbon, halo_metal, helmet]


def wheel(name, pivot, radius, width, outward, segments, level, rubber, rim):
    a = width / 2
    tyre = [(-a, 0.23), (-a, 0.31), (-a + 0.015, 0.345), (-a + 0.04, radius), (a - 0.04, radius), (a - 0.015, 0.345), (a, 0.31), (a, 0.23)]
    if level == 2:
        tyre = [(-a, 0.23), (-a, radius), (a, radius), (a, 0.23)]
    face = [(a - 0.005, 0.228), (a - 0.05, 0.20), (a - 0.07, 0.06), (a - 0.075, 0.0)]
    back = [(-a + 0.02, 0.0), (-a + 0.005, 0.228)]
    if outward < 0:
        tyre = [(-x, r) for x, r in reversed(tyre)]
        face = [(-x, r) for x, r in face]
        back = [(-x, r) for x, r in back]
    lathe(name, [(0, tyre), (1, face), (1, back)], segments, [rubber, rim], pivot)


def lod_name(name, level):
    return f"{name}_LOD{level}"


def select_only(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(parts, name):
    body = parts[0]
    with bpy.context.temp_override(
        active_object=body, selected_objects=parts, selected_editable_objects=parts
    ):
        if bpy.ops.object.join() != {"FINISHED"}:
            raise RuntimeError(f"could not join {name}")
    select_only(body)
    body.name = name
    body.data.name = name
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    return body


# --- baking and LODs ----------------------------------------------------------------------


def bake(body, materials, size, samples, out_dir):
    select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.world = scene.world or bpy.data.worlds.new("world")
    scene.world.light_settings.distance = 0.6

    # A temporary ground darkens the underside the way the track will.
    ground = box("bake_ground", (0, -0.53, 0), (6, 0.005, 6), None)
    images = {}
    for kind, bake_type in (("normal", "NORMAL"), ("ao", "AO")):
        image = bpy.data.images.new(f"fr26_{kind}", size, size, alpha=False, is_data=True)
        image.colorspace_settings.name = "Non-Color"
        for m in materials:
            node = m.node_tree.nodes.get("bake_target") or m.node_tree.nodes.new("ShaderNodeTexImage")
            node.name = "bake_target"
            node.image = image
            m.node_tree.nodes.active = node
        select_only(body)
        bpy.ops.object.bake(type=bake_type, normal_space="TANGENT", use_clear=True, margin=8)
        image.filepath_raw = str(out_dir / f"fr26_{kind}.png")
        image.file_format = "PNG"
        image.save()
        images[kind] = image
    bpy.data.objects.remove(ground)

    output_group = gltf_output_group()
    for m in materials:
        nodes, links = m.node_tree.nodes, m.node_tree.links
        for node in [n for n in nodes if n.type != "BSDF_PRINCIPLED" and n.type != "OUTPUT_MATERIAL"]:
            nodes.remove(node)
        shader = nodes["Principled BSDF"]
        normal_tex = nodes.new("ShaderNodeTexImage")
        normal_tex.image = images["normal"]
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
        ao_tex = nodes.new("ShaderNodeTexImage")
        ao_tex.image = images["ao"]
        split = nodes.new("ShaderNodeSeparateColor")
        links.new(ao_tex.outputs["Color"], split.inputs["Color"])
        settings = nodes.new("ShaderNodeGroup")
        settings.node_tree = output_group
        links.new(split.outputs["Red"], settings.inputs["Occlusion"])


def gltf_output_group():
    """The node group the glTF exporter reads the occlusion texture from."""
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def decimated(source, name, ratio, parent):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    obj.data.name = name
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    select_only(obj)
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def strip_bump(materials):
    for m in materials:
        for node in [n for n in m.node_tree.nodes if n.name == "bake_bump"]:
            m.node_tree.nodes.remove(node)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--car", required=True)
    parser.add_argument("--interface", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--samples", type=int, default=64)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])

    car = json.loads(Path(args.car).read_text())
    spec = json.loads(Path(args.interface).read_text())
    if spec["lodCount"] != 3:
        raise SystemExit("fr26_car.py builds exactly three LODs")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, lod0, body_materials = build(car, spec, args.texture_size)
    with tempfile.TemporaryDirectory() as tmp:
        bake(lod0, body_materials, args.texture_size, args.samples, Path(tmp))
        # Carbon parts outside the body (flaps) share the material but not its UVs, so
        # they keep plain PBR values: give them their own copy without baked maps.
        flap_carbon = material("carbon_flap", (0.025, 0.025, 0.028), 0.1, 0.45)
        for obj in bpy.data.objects:
            if obj.type == "MESH" and obj.parent and obj.parent.name in spec["flaps"]:
                obj.data.materials[0] = flap_carbon
        decimated(lod0, lod_name(spec["body"], 1), 0.25, body)
        decimated(lod0, lod_name(spec["body"], 2), 0.06, body)
        strip_bump(bpy.data.materials)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=args.out,
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_cameras=False,
            export_lights=False,
            export_animations=False,
            export_extras=False,
        )
    print(f"exported {args.out}")


main()

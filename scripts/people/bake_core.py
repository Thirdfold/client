# The shared half of the NPC minis (M76 #330, docs/ASSETS.md "The people minis"): a high-poly
# source (a Sketchfab museum scan, or a MakeHuman figure with its clothes) is decimated to a
# few thousand triangles, unwrapped into one atlas, and its colour, normals, occlusion and
# roughness are baked onto it from the source; a tint mask (ORM alpha) marks one clothing region.
# Runs in headless Blender (the `bpy` wheel, Python 3.11), never in CI:
#   <bpy python> -I scripts/people/statue_mini.py <spec.json>
#   <bpy python> -I scripts/people/human_mini.py <spec.json>
# Output, in the spec's `out` directory: mesh.glb (geometry and UVs only, no materials),
# albedo.png, normal.png (OpenGL, tangent space), orm.png (R occlusion, G roughness, B metal 0,
# A tint mask). scripts/people/assemble.ts turns them into art/npc/<id>/<id>.glb.

import bpy, math, os, sys
import numpy as np
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def flatten_hierarchy():
    """Unparent every mesh keeping its place, delete the empties, and bake the transforms in."""
    objs = meshes()
    select_only(objs)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    select_only(meshes())
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(objs):
    mn = Vector((1e18,) * 3)
    mx = Vector((-1e18,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(min(a, b) for a, b in zip(mn, w))
            mx = Vector(max(a, b) for a, b in zip(mx, w))
    return mn, mx


def normalise(objs, height, rotate=(0, 0, 0), foot_share=0.12):
    """Rotate (degrees, XYZ), scale to `height` along Z, stand on z=0 centred on the feet.

    The model faces -Y here (Blender's front); the glTF export turns that into +Z."""
    from mathutils import Euler, Matrix
    rot = Euler([math.radians(a) for a in rotate], 'XYZ').to_matrix().to_4x4()
    for o in objs:
        o.data.transform(rot @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    mn, mx = bounds(objs)
    k = height / (mx.z - mn.z)
    # The feet's centre: the middle of the lowest slice's vertices.
    zlim = mn.z + foot_share * (mx.z - mn.z)
    xs, ys = [], []
    for o in objs:
        for v in o.data.vertices:
            if v.co.z <= zlim:
                xs.append(v.co.x)
                ys.append(v.co.y)
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    move = Matrix.Translation((-cx * k, -cy * k, -mn.z * k)) @ Matrix.Scale(k, 4)
    for o in objs:
        o.data.transform(move)
    return k


def triangles(objs):
    n = 0
    for o in objs:
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


def make_low(highs, target):
    """One decimated, welded, unwrapped copy of every high-poly object together."""
    copies = []
    for o in highs:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.collection.objects.link(c)
        copies.append(c)
    select_only(copies)
    bpy.ops.object.join()
    low = bpy.context.view_layer.objects.active
    low.name = 'low'
    low.data.materials.clear()
    # UV seams split vertices, and the collapse cannot cross a split: weld the copy with no UVs.
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
    select_only([low])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=2e-5)
    bpy.ops.object.mode_set(mode='OBJECT')
    bm_total = triangles([low])
    # A first, gentle collapse when the source is huge, then the real one with its UVs gone.
    mod = low.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target / max(1, bm_total))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='decimate')
    select_only([low])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.select_all(action='SELECT')
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
    low.data.uv_layers.new(name='UVMap')
    bpy.ops.uv.smart_project(angle_limit=math.radians(80), island_margin=0.004, area_weight=0.6)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    return low


def bake_setup(samples=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.bake_type = 'DIFFUSE'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bpy.context.scene.world = world
    return sc


def bake_pass(highs, low, kind, size, extrusion, name, colorspace='Non-Color', **kw):
    """Bakes `kind` from `highs` onto `low` into a new image; returns the numpy array (h, w, 4)."""
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = colorspace
    mat = low.data.materials[0] if low.data.materials else None
    if mat is None:
        mat = bpy.data.materials.new('bake')
        mat.use_nodes = True
        low.data.materials.append(mat)
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    select_only(highs + [low], active=low)
    bpy.ops.object.bake(
        type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=0.0,
        margin=max(8, size // 64), margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES', **kw)
    nt.nodes.remove(node)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    return px


def box_down(a, size):
    f = a.shape[0] // size
    if f <= 1:
        return a
    return a.reshape(size, f, size, f, a.shape[2]).mean(axis=(1, 3))


def save_png(px, path, alpha_mode='NONE'):
    h, w, _ = px.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.alpha_mode = alpha_mode
    img.pixels = np.clip(px, 0, 1).astype(np.float32).ravel().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def export_mesh(low, path):
    select_only([low])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_materials='NONE',
        export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False,
        export_yup=True, export_apply=True)


def emission_material(name, node_setup=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    if node_setup:
        node_setup(nt, em)
    else:
        em.inputs['Color'].default_value = (1, 1, 1, 1)
    return m


def height_ramp(z0, z1):
    """An emission material white below z0, black above z1 (object space = world space here)."""
    def setup(nt, em):
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = z1
        mr.inputs['From Max'].default_value = z0
        mr.clamp = True
        nt.links.new(geo.outputs['Position'], sep.inputs['Vector'])
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], em.inputs['Color'])
    return emission_material('mask_height', setup)


def bake_mask(highs, low, size, extrusion, mask_for):
    """The tint mask baked from `highs` with each object's materials swapped for a flat one.

    `mask_for(obj)` returns the material that object is baked with (white where it carries the
    tint, black elsewhere)."""
    saved = []
    for o in highs:
        saved.append([s.material for s in o.material_slots])
        m = mask_for(o)
        if not o.material_slots:
            o.data.materials.append(m)
        for s in o.material_slots:
            s.material = m
    px = bake_pass(highs, low, 'EMIT', size, extrusion, 'mask')
    for o, mats in zip(highs, saved):
        for s, m in zip(o.material_slots, mats):
            s.material = m
    return px[:, :, 0]


def pack_and_save(out, size, bake, mask, ao_strength=0.8, gain=1.0):
    """Writes albedo.png, normal.png, orm.png at `size` from the 2x bakes."""
    os.makedirs(out, exist_ok=True)
    albedo = box_down(bake['albedo'], size)
    albedo[:, :, :3] = np.clip(albedo[:, :, :3] * gain, 0, 1)
    normal = box_down(bake['normal'], size)
    n = normal[:, :, :3] * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    normal[:, :, :3] = n * 0.5 + 0.5
    ao = box_down(bake['ao'], size)[:, :, 0]
    rough = box_down(bake['rough'], size)[:, :, 0]
    m = box_down(mask[:, :, None], size)[:, :, 0]
    orm = np.zeros((size, size, 4), np.float32)
    orm[:, :, 0] = 1 - ao_strength * (1 - ao)
    orm[:, :, 1] = rough
    orm[:, :, 2] = 0
    orm[:, :, 3] = m
    albedo[:, :, 3] = 1
    normal[:, :, 3] = 1
    save_png(albedo, os.path.join(out, 'albedo.png'))
    save_png(normal, os.path.join(out, 'normal.png'))
    save_png(orm, os.path.join(out, 'orm.png'), 'CHANNEL_PACKED')


def bake_all(highs, low, spec, mask_for):
    size2 = spec['texture'] * 2
    ext = spec.get('extrusion', 0.025) * spec['height']
    bake_setup(spec.get('samples', 24))
    bake = {}
    bake['albedo'] = bake_pass(highs, low, 'DIFFUSE', size2, ext, 'albedo', 'sRGB', pass_filter={'COLOR'})
    bake['normal'] = bake_pass(highs, low, 'NORMAL', size2, ext, 'normal', normal_space='TANGENT')
    bake['rough'] = bake_pass(highs, low, 'ROUGHNESS', size2, ext, 'rough')
    bake['ao'] = bake_pass(highs, low, 'AO', size2, ext, 'ao')
    mask = bake_mask(highs, low, size2, ext, mask_for)
    pack_and_save(spec['out'], spec['texture'], bake, mask, spec.get('aoStrength', 0.8), spec.get('albedoGain', 1.0))
    export_mesh(low, os.path.join(spec['out'], 'mesh.glb'))
    print('BAKED', spec['out'], 'tris', triangles([low]))

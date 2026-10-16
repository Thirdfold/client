# A MakeHuman person (MPFB 2.0.18, all assets CC0, output CC0) as a mini (M76 #330): built
# headless, posed out of the T-pose, dressed in its CC0 clothes, then baked to one atlas by
# bake_core.py. spec.json (see scripts/people/specs/*.json):
#   { "height": 0.95, "texture": 512, "triangles": 5000, "samples": 24,
#     "macro": { "gender": 0.0, "age": 0.55, "weight": 0.5, "muscle": 0.5, "height": 0.5, ... },
#     "skin": "young_caucasian_female", "eyes": "high-poly",
#     "clothes": [{ "name": "toigo_camisole_dress_with_full_skirt", "cloth": "#cdbf9f", "print": 0.1 }],
#     "tint": ["toigo_camisole_dress_with_full_skirt"],
#     "hair": "braid01", "hairColour": "#3a2a1d", "arm": 72, "elbow": 14 }
# usage: <bpy python> -I human_mini.py <spec.json> <out dir>
# env: BLENDER_USER_RESOURCES (a dir MPFB's assets are unpacked into), MPFB_ZIP (the add-on).
# A clothing entry may be a name alone; `cloth` re-dyes it from its own texture's light and dark
# (`print` how much of the texture's pattern stays, 0 flat to 1 as authored). Beards and moustaches
# are dyed with `hairColour`. Hair cards are made solid, in `hairColour`.

import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Matrix, Vector
import bake_core as core

spec = json.load(open(sys.argv[-2]))
spec['out'] = sys.argv[-1]
core.reset()
bpy.ops.extensions.package_install_files(filepath=os.environ['MPFB_ZIP'], repo='user_default', enable_on_install=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

D = LocationService.get_user_data()
data = lambda *p: os.path.join(D, 'data', *p) if os.path.isdir(os.path.join(D, 'data')) else os.path.join(D, *p)


def hexcolour(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c] + [1]


macro = TargetService.get_default_macro_info_dict()
macro.update(spec['macro'])
base = HumanService.create_human(
    mask_helpers=True, detailed_helpers=False, extra_vertex_groups=False, macro_detail_dict=macro)
# The body's shape lives in shape keys on top of the default mesh: make it the mesh itself before
# the rig is fitted and the clothes are, or both fit the default body (a child's arm swings from an
# adult's shoulder).
core.select_only([base])
if base.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
rig = HumanService.add_builtin_rig(base, 'game_engine')
bpy.context.view_layer.update()
if os.environ.get('POSE_DEBUG'):
    zs = [v.co.z for v in base.data.vertices]
    print('FIT', 'mesh z', round(min(zs), 3), round(max(zs), 3), 'foot head', round(rig.pose.bones['foot_l'].head.z, 3), 'head tail', round(rig.pose.bones['head'].tail.z, 3), 'loc', tuple(rig.location))
HumanService.set_character_skin(data('skins', spec['skin'], spec['skin'] + '.mhmat'), base, skin_type='GAMEENGINE')

parts = {'body': base}
eyes = HumanService.add_mhclo_asset(
    data('eyes', spec.get('eyes', 'high-poly'), spec.get('eyes', 'high-poly') + '.mhclo'), base,
    asset_type='Eyes', material_type='PROCEDURAL_EYES')
parts['eyes'] = eyes
for entry in spec['clothes']:
    c = entry if isinstance(entry, dict) else {'name': entry}
    parts[c['name']] = HumanService.add_mhclo_asset(
        data('clothes', c['name'], c['name'] + '.mhclo'), base, asset_type='Clothes',
        material_type='GAMEENGINE', subdiv_levels=0)
if spec.get('hair'):
    parts['hair'] = HumanService.add_mhclo_asset(
        data('hair', spec['hair'], spec['hair'] + '.mhclo'), base, asset_type='Hair', material_type='GAMEENGINE')

# The rig comes fitted in a frame about 0.75 below the mesh: lift the rig, keep the meshes where
# they are (their parent inverse takes the lift back), so the bones lie in the body.
bpy.context.view_layer.update()
top = max(v.co.z for v in base.data.vertices)
rig.location.z += top - (rig.matrix_world @ rig.pose.bones['head'].tail).z
bpy.context.view_layer.update()
for o in parts.values():
    o.matrix_parent_inverse = rig.matrix_world.inverted()
if os.environ.get('POSE_DEBUG'):
    bpy.context.view_layer.update()
    g = base.vertex_groups['upperarm_l'].index
    vs = [v for v in base.data.vertices if any(x.group == g and x.weight > 0.95 for x in v.groups)]
    c = sum((v.co for v in vs), Vector()) / max(1, len(vs))
    print('FRAME', 'mw', tuple(base.matrix_world.translation), 'pinv', tuple(base.matrix_parent_inverse.translation), 'rigw', tuple(rig.matrix_world.translation))
    print('FRAME2 upperarm weighted centroid local', tuple(c), 'world', tuple(base.matrix_world @ c), 'bone head world', tuple(rig.matrix_world @ rig.pose.bones['upperarm_l'].head), 'tail', tuple(rig.matrix_world @ rig.pose.bones['upperarm_l'].tail))

# ---- pose: arms down from the T-pose, a slight forward bend at the elbow
bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
pb = rig.pose.bones


def turn(bone, axis, degrees):
    """Turns a bone about an armature-space axis (X, Y or Z) by setting its rotation channel."""
    b = pb[bone]
    b.rotation_mode = 'QUATERNION'
    vec = Vector({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis])
    local = b.bone.matrix_local.to_3x3().inverted() @ vec
    b.rotation_quaternion = b.rotation_quaternion @ Matrix.Rotation(math.radians(degrees), 3, local).to_quaternion()
    bpy.context.view_layer.update()
    if os.environ.get('POSE_DEBUG'):
        print('POSE', bone, tuple(round(x, 3) for x in b.head), tuple(round(x, 3) for x in b.tail))


arm = spec.get('arm', 70)
for side, sign in (('l', 1), ('r', -1)):
    turn(f'clavicle_{side}', 'Y', sign * spec.get('shoulder', 8))
    turn(f'upperarm_{side}', 'Y', sign * arm)
    turn(f'lowerarm_{side}', 'X', -spec.get('elbow', 12))
    turn(f'hand_{side}', 'Y', sign * 6)
bpy.ops.object.mode_set(mode='OBJECT')
if os.environ.get('POSE_DEBUG'):
    for o in parts.values():
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                print('ARMMOD', o.name, m.use_vertex_groups, m.use_bone_envelopes, m.use_deform_preserve_volume, m.object and m.object.name, len(o.vertex_groups), o.parent and o.parent.name)
    print('HEADBONE', tuple(pb['head'].tail), tuple(pb['foot_l'].head), tuple(base.dimensions), tuple(rig.dimensions))
    print('ARM', tuple(rig.scale), tuple(rig.location), tuple(base.location), tuple(base.scale), rig.data.pose_position)

# ---- apply the pose, helpers and shapes: every part becomes a plain mesh
if os.environ.get('POSE_DEBUG'):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = base.evaluated_get(dg).to_mesh()
    xs = [v.co.x for v in ev.vertices]
    print('EVALX', min(xs), max(xs), 'raw', min(v.co.x for v in base.data.vertices), max(v.co.x for v in base.data.vertices), 'shapekeys', base.data.shape_keys and len(base.data.shape_keys.key_blocks))
objs = list(parts.values())
for o in objs:
    core.select_only([o])
    if o.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(o.modifiers):
        if m.type in ('ARMATURE', 'MASK'):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception as e:
                print('MOD_ERR', o.name, m.name, repr(e)[:100])
for o in objs:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.data.objects.remove(rig, do_unlink=True)

# ---- the body under clothes is not needed
body = parts['body']
under = [g.index for g in body.vertex_groups if g.name.startswith('Delete.')]
core.select_only([body])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
n = 0
for v in body.data.vertices:
    if any(g.group in under and g.weight > 0.5 for g in v.groups):
        v.select = True
        n += 1
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.delete(type='VERT')
bpy.ops.object.mode_set(mode='OBJECT')
print('UNDER', n)

# ---- materials: dye cloth, solid hair
HAIR = [k for k in parts if k == 'hair' or 'beard' in k or 'moustache' in k]


def flat(obj, colour, rough=0.7):
    obj.data.materials.clear()
    m = bpy.data.materials.new(obj.name + '.flat')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hexcolour(colour)
    b.inputs['Roughness'].default_value = rough
    obj.data.materials.append(m)


def dye(obj, colour, keep):
    """Base colour = `colour` lit and shadowed like the authored texture (`keep` of its pattern)."""
    for m in obj.data.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        link = bsdf.inputs['Base Color'].links
        if not link:
            bsdf.inputs['Base Color'].default_value = hexcolour(colour)
            continue
        src = link[0].from_node
        img = src.image if src.type == 'TEX_IMAGE' else None
        px = np.array(img.pixels[:], np.float32).reshape(-1, 4)[::97] if img else None
        mean = float((px[:, :3] @ np.array([0.3, 0.6, 0.1])).mean()) if img is not None else 0.5
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(link[0].from_socket, bw.inputs['Color'])
        k = nt.nodes.new('ShaderNodeMath')
        k.operation = 'DIVIDE'
        nt.links.new(bw.outputs['Val'], k.inputs[0])
        k.inputs[1].default_value = max(mean, 0.05)
        mixk = nt.nodes.new('ShaderNodeMix')
        mixk.data_type = 'FLOAT'
        mixk.inputs[0].default_value = keep
        mixk.inputs[2].default_value = 1.0
        nt.links.new(k.outputs[0], mixk.inputs[3])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs[0].default_value = 1.0
        ins = [i for i in mul.inputs if i.enabled]
        ins[1].default_value = hexcolour(colour)
        nt.links.new([o for o in mixk.outputs if o.enabled][0], ins[2])
        nt.links.new([o for o in mul.outputs if o.enabled][0], bsdf.inputs['Base Color'])


for key in HAIR:
    flat(parts[key], spec.get('hairColour', '#3a2a1d'), 0.55)
for entry in spec['clothes']:
    c = entry if isinstance(entry, dict) else {'name': entry}
    if c['name'] in HAIR:
        continue
    if 'cloth' in c:
        dye(parts[c['name']], c['cloth'], c.get('print', 0.15))

highs = list(parts.values())
if os.environ.get('POSE_DEBUG'):
    mn, mx = core.bounds([parts['body']])
    print('BODYBOUNDS', tuple(round(x, 3) for x in mn), tuple(round(x, 3) for x in mx))
# Scale and stand: all parts together, facing -Y (the glTF export makes that +Z).
core.normalise(highs, spec['height'], spec.get('rotate', (0, 0, 0)))
print('HIGH tris', core.triangles(highs))

low = core.make_low(highs, spec['triangles'])
tint = set(spec.get('tint', []))
white = core.emission_material('mask_on')
black = core.emission_material('mask_off', lambda nt, em: em.inputs['Color'].__setattr__('default_value', (0, 0, 0, 1)))
core.bake_all(highs, low, spec, lambda o: white if any(o is parts[t] for t in tint if t in parts) else black)

# Looks at a baked mini in Blender (Cycles, CPU): its maps on its mesh from four sides, and the
# tint mask tinted to a colour. usage: <bpy python> -I preview.py <dir with mesh.glb and maps>
#   <out.png> [tint #rrggbb]
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

args = sys.argv[1:]
src, out = args[0], args[1]
tint = args[2] if len(args) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src, 'mesh.glb'))
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mat = bpy.data.materials.new('m')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']


def tex(name, cs):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(os.path.join(src, name))
    n.image.colorspace_settings.name = cs
    if name == 'orm.png':
        n.image.alpha_mode = 'CHANNEL_PACKED'
    return n


alb, nor, orm = tex('albedo.png', 'sRGB'), tex('normal.png', 'Non-Color'), tex('orm.png', 'Non-Color')
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
base = alb.outputs['Color']
if tint:
    c = [int(tint[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    col = nt.nodes.new('ShaderNodeRGB')
    col.outputs[0].default_value = [(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c] + [1]
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    m = bpy.data.images.new('mask', 512, 512)
    o = bpy.data.images.load(os.path.join(src, 'orm.png'))
    a = np.array(o.pixels[:], np.float32).reshape(-1, 4)[:, 3]
    m.pixels = np.stack([a, a, a, np.ones_like(a)], 1).ravel().tolist()
    m.filepath_raw = out + '.mask.png'
    m.file_format = 'PNG'
    m.save()
    m = bpy.data.images.load(out + '.mask.png')
    m.colorspace_settings.name = 'Non-Color'
    mk = nt.nodes.new('ShaderNodeTexImage')
    mk.image = m
    nt.links.new(mk.outputs['Color'], [i for i in mix.inputs if i.enabled][0])
    ins = [i for i in mix.inputs if i.enabled]
    print('MIXIN', [(i.name, i.type) for i in ins])
    nt.links.new(alb.outputs['Color'], ins[1])
    nt.links.new(col.outputs[0], ins[2])
    base = [x for x in mix.outputs if x.enabled][0]
    if os.environ.get('SHOWMASK'): base = mk.outputs['Color']
nt.links.new(base, bsdf.inputs['Base Color'])
nm = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(nor.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
obj.data.materials.clear()
obj.data.materials.append(mat)
bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
h = max(v.z for v in bb)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.render.resolution_x = sc.render.resolution_y = 384
sc.render.film_transparent = False
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.52, 0.56, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
sc.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
bpy.context.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
bpy.context.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = h * 1.2
tiles = []
for deg in (0, 45, 90, 180):
    a = math.radians(deg)
    # glTF +Z is the front; Blender -Y after import.
    d = Vector((math.sin(a) * 1, -math.cos(a), 0.25)).normalized() * h * 3
    cam.location = Vector((0, 0, h * 0.5)) + d
    look = Vector((0, 0, h * 0.5)) - cam.location
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    path = out + f'.{deg}.png'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(path)
    px = np.array(im.pixels[:], np.float32).reshape(im.size[1], im.size[0], 4)
    tiles.append(px)
    os.remove(path)
sheet = np.concatenate(tiles, axis=1)
img = bpy.data.images.new('sheet', sheet.shape[1], sheet.shape[0], alpha=True)
img.pixels = sheet.ravel().tolist()
img.filepath_raw = out
img.file_format = 'PNG'
img.save()
print('PREVIEW', out)

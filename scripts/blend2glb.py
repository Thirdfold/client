# Blender (bpy, headless) converts a downloaded .blend or .fbx to a GLB for the CC0 glue
# (scripts/fetch-models.ts, a meta's "convert": "blender"; docs/ASSETS.md "CC0 packs"):
#   BPY_PYTHON=<python with bpy> npx tsx scripts/fetch-models.ts <id>
#   <python with bpy> -I scripts/blend2glb.py in.(blend|fbx|obj|glb) out.glb
# An FBX export loses its texture links, so a material with no colour map takes the image
# whose name matches the material's (Monster_baseMap for "Monster"), the way the artist meant.
import bpy, os, re, sys

src, dst = sys.argv[-2], sys.argv[-1]
ext = os.path.splitext(src)[1].lower()
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    else:
        raise SystemExit('unsupported ' + ext)
for m in bpy.data.materials:
    if m.node_tree is None:
        colour = tuple(m.diffuse_color)
        m.use_nodes = True
        bsdf = next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is not None:
            bsdf.inputs['Base Color'].default_value = colour  # a nodeless material's own colour
bpy.context.scene.world = None


def norm(s):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\.(jpg|jpeg|png|tga|bmp)(\.\d+)?$', '', s.lower()))


def legacy(m):
    """A Cycles-era graph (diffuse + glossy mixed, no Principled BSDF) becomes one: its colour image into
    Base Color, the Normal Map node's image into Normal, so the glTF exporter sees both maps."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    out = next((x for x in nodes if x.type == 'OUTPUT_MATERIAL'), None)
    if out is None or any(x.type == 'BSDF_PRINCIPLED' for x in nodes):
        return
    images = [x for x in nodes if x.type == 'TEX_IMAGE' and x.image and x.image.size[0] > 0]
    nmap = next((x for x in nodes if x.type == 'NORMAL_MAP'), None)
    feeds = [x for x in images if nmap and any(l.from_node == x and l.to_node == nmap for l in links)]
    colour = [x for x in images if x not in feeds and not re.search(r'nrm|normal', x.image.name, re.I)]
    if not colour:
        return
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(colour[0].outputs['Color'], bsdf.inputs['Base Color'])
    if feeds and nmap:
        feeds[0].image.colorspace_settings.name = 'Non-Color'
        links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])


for m in bpy.data.materials:
    if m.node_tree is not None:
        legacy(m)


for name in sorted(os.listdir(os.path.dirname(os.path.abspath(src)))):  # textures beside the file
    if name.lower().endswith(('.png', '.jpg', '.jpeg', '.tga')):
        bpy.data.images.load(os.path.join(os.path.dirname(os.path.abspath(src)), name), check_existing=True)
images = [i for i in bpy.data.images if i.source == 'FILE' and (i.packed_file or i.size[0] > 0)]
COLOUR = re.compile(r'base ?(map|colou?r)|albedo|diffuse|_diff|_col\b', re.I)
NORMAL = re.compile(r'normal|_nor', re.I)
alone = len(bpy.data.materials) == 1
for m in bpy.data.materials:
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = next((x for x in nodes if x.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        continue
    name = norm(m.name)
    named = [i for i in images if norm(i.name) == name] or [
        i for i in images if name and (name in norm(i.name) or norm(i.name) in name)
    ]
    if not bsdf.inputs['Base Color'].is_linked:
        found = ([i for i in images if COLOUR.search(i.name)] if alone else []) or named
        if found:
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = found[0]
            links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    # an FBX import leaves a Normal Map node with no image behind
    bump = next((x for x in nodes if x.type == 'NORMAL_MAP' and not x.inputs['Color'].is_linked), None)
    if alone and (bump or not bsdf.inputs['Normal'].is_linked):
        found = [i for i in images if NORMAL.search(i.name)]
        if found:
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = found[0]
            tex.image.colorspace_settings.name = 'Non-Color'
            bump = bump or nodes.new('ShaderNodeNormalMap')
            links.new(tex.outputs['Color'], bump.inputs['Color'])
            links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_apply=True, export_image_format='AUTO',
    export_animations=False, export_cameras=False, export_lights=False,
)

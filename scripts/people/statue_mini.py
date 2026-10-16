# A Sketchfab museum scan (CC0, glTF archive pinned by SHA-256 in the figure's meta.json) as a mini
# (M76 #330): see bake_core.py. spec.json:
#   { "archive": "<sha256 of the Sketchfab glTF archive, unzipped in art/_packs/<sha256>/>", "height": 0.9, "texture": 512, "triangles": 5000,
#     "rotate": [0, 0, 0], "tint": [0.0, 0.62], "samples": 24 }
# `rotate` stands the scan upright and faces it -Y (degrees, XYZ); `tint` is the band of the
# figure's height (share of it, from the feet) whose cloth takes the token's colour.

import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import bake_core as core

spec = json.load(open(sys.argv[-2]))
spec['out'] = sys.argv[-1]
core.reset()
bpy.ops.import_scene.gltf(filepath=os.path.join('art', '_packs', spec['archive'], 'scene.gltf'))
core.flatten_hierarchy()
highs = core.meshes()
core.normalise(highs, spec['height'], spec.get('rotate', (0, 0, 0)))
print('HIGH tris', core.triangles(highs))
low = core.make_low(highs, spec['triangles'])
z0, z1 = [t * spec['height'] for t in spec['tint']]
ramp = core.height_ramp(z0, z1)
core.bake_all(highs, low, spec, lambda o: ramp)

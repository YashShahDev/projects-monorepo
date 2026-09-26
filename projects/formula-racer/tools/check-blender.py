"""Export disposable fixtures to verify Blender's background glTF/image pipeline."""
import sys
from pathlib import Path

import bpy

output = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
bpy.ops.export_scene.gltf(filepath=str(output / "fixture.glb"), export_format="GLB")
image = bpy.data.images.new("encoder-fixture", width=4, height=4)
image.pixels[:] = [0.25, 0.5, 0.75, 1.0] * 16
image.filepath_raw = str(output / "fixture.png")
image.file_format = "PNG"
image.save()
print("Blender background Python and GLB/PNG exports passed")

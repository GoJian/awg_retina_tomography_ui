#!/usr/bin/env bash
# Rebuild optimized/anatomy/eye-anatomy.glb from feelpp/mesh.eye.
#
#   ./build-anatomy.sh [work_dir]
#
# Tessellates mesh.eye's `Eye.step` into one watertight mesh per anatomical
# solid, packs them into a single glTF with one named node each, then
# Draco-compresses. Result: ~147k triangles, ~350 KB.
#
# Requires: python3 with `gmsh trimesh numpy networkx` (pip), and the
# gltf-transform CLI (`npm i -g @gltf-transform/cli`).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../../optimized/anatomy/eye-anatomy.glb"
WORK="${1:-$HERE/work}"

mkdir -p "$WORK"
if [ ! -d "$WORK/mesh.eye" ]; then
  echo "1/5  clone feelpp/mesh.eye (GPL-3.0)"
  git clone --depth 1 https://github.com/feelpp/mesh.eye.git "$WORK/mesh.eye"
fi

echo "2/5  tessellate Eye.step -> one mesh per solid"
python3 "$HERE/extract_eye.py" "$WORK/mesh.eye/Eye.step" "$WORK/parts" 500

echo "3/5  assemble named + coloured glTF"
python3 "$HERE/build_glb.py" "$WORK/parts" "$WORK/raw.glb"

echo "4/5  Draco compress"
gltf-transform draco "$WORK/raw.glb" "$OUT"

echo "5/5  refresh the licence + provenance shipped beside it"
cp "$WORK/mesh.eye/LICENSE" "$(dirname "$OUT")/LICENSE"
cp "$WORK/parts/manifest.json" "$(dirname "$OUT")/structures.json"

echo "done -> $OUT ($(du -h "$OUT" | cut -f1))"

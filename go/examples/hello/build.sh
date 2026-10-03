#!/bin/sh
# Build the hello perfscale library component with TinyGo.
#
# Produces hello.wasm: a component exporting perfscale:library/library@0.1.0
# with no wasi:random import (the engine rejects wasi:random at load time).
#
# Requires: tinygo (wasip2), wasm-tools, wasm-opt (binaryen), python3.
#
# Why not plain `tinygo build -target=wasip2 -o hello.wasm .`?
#   1. TinyGo always wraps the module in the wasi:cli/command world, so the
#      component would export wasi:cli/run instead of perfscale:library/library.
#      We re-componentize the extracted core module against wit/world.wit,
#      which declares the imports the TinyGo runtime links plus our export.
#   2. TinyGo's runtime links wasi:random get-random-u64 (startup PRNG seed)
#      and get-random-bytes (behind the never-called arc4random_buf export).
#      The engine hard-rejects wasi:random, so tools/patch_component.py +
#      wasm-opt strip both (see the tool's docstring for details).
set -eu
cd "$(dirname "$0")"

BUILD=.build
rm -rf "$BUILD"
mkdir -p "$BUILD"

tinygo build -target=wasip2 -buildmode=c-shared -o "$BUILD/component.wasm" .
python3 tools/patch_component.py extract "$BUILD/component.wasm" "$BUILD/core.wasm"
wasm-opt "$BUILD/core.wasm" --remove-unused-module-elements -o "$BUILD/core.opt.wasm"
python3 tools/patch_component.py rename-random "$BUILD/core.opt.wasm" "$BUILD/core.final.wasm"
wasm-tools component embed wit --world perfscale-library-wasi "$BUILD/core.final.wasm" -o "$BUILD/core.embed.wasm"
wasm-tools component new "$BUILD/core.embed.wasm" -o hello.wasm

wasm-tools validate hello.wasm
echo "OK wrote hello.wasm — component shape:"
wasm-tools component wit hello.wasm | sed -n '1,16p'

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git submodule update --init -- chimera
target_dir="${CARGO_TARGET_DIR:-$PWD/target}"
cargo build --manifest-path chimera/Cargo.toml --target-dir "$target_dir" \
  -p chimera-wasm --release --target wasm32-unknown-unknown
cp "$target_dir/wasm32-unknown-unknown/release/chimera_wasm.wasm" chimera/src/wasm/chimera.wasm

mkdir -p out/audition-public/data
cp chimera/public/data/cmudict.txt.gz out/audition-public/data/
cp public/rehearsal/cast/gruff/staged-front.webp out/audition-public/gruff.webp
cp public/rehearsal/cast/neon/staged-front.webp out/audition-public/vee.webp
./node_modules/.bin/vite build --config audition/vite.config.ts

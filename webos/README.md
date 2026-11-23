# ESP32 Firmware Lab

The WebOS launcher starts the LilyGO TTGO T-Display with the upstream
MicroPython preset. The program editor saves and opens UTF-8 Python files
and `.esp32lab.json` projects through My files. A project stores the preset
and Python text. Run Python sends the current program to the MicroPython
UART0 prompt. The console shows the program output. The app handles programs
up to 32 KiB. The emulator's own firmware and console controls are available
alongside the editor.

Build the emulator from this repository with Rust 1.99.1 including the
`wasm32-unknown-unknown` target. The engine and selected firmware inputs
are verified by SHA-256 during staging.

```sh
rustup target add --toolchain 1.99.1 wasm32-unknown-unknown
. ./tools/wasm-rustflags.sh
cargo +1.99.1 build --release --locked --target wasm32-unknown-unknown -p esp32sim-wasm

inputs=$(mktemp -d)
cp target/wasm32-unknown-unknown/release/esp32sim_wasm.wasm "$inputs/esp32sim.wasm"
tools/fetch-rom-elfs.sh "$inputs/fw"
tools/fetch-micropython.sh "$inputs/fw"
tools/fetch-web-vendor.sh
mkdir "$inputs/vendor"
cp web/vendor/xterm/{xterm.js,xterm.css,LICENSE} "$inputs/vendor/"
python3 webos/prepare-webos.py --inputs "$inputs" --output "$inputs/stage/esp32sim"
```

Set the WebOS app builder's `source` to the prepared `stage` directory and
`apps` to `["esp32sim"]`. The source and license references are in
[NOTICES.txt](legal/NOTICES.txt).

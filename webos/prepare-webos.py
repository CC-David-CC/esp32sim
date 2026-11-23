#!/usr/bin/env python3
"""Package the pinned ESP32 emulator and T-Display preset for the WebOS app builder."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
INTEGRATION = APP / "webos"

INPUTS = {
    "esp32sim.wasm": (
        "wasm/esp32sim.wasm", "8bd7e90979a83347331ec53168498f57a1fca47d1e3dd8e00c9106ea22597498",
    ),
    "fw/esp32_rev300_rom.elf": (
        "wasm/fw/esp32_rev300_rom.data", "920b70635440517866aab2230964a570d2cf2b676658d93c52fbac108c1cca31",
    ),
    "fw/ESP32_GENERIC-20260824-v1.29.0.bin": (
        "wasm/fw/ESP32_GENERIC-20260824-v1.29.0.data", "e67ad6015a0a504c1fec9aa9bbf589d0432ed28e62546f4f8dd8a147f8bd95f6",
    ),
    "vendor/xterm.js": (
        "vendor/xterm/xterm.js", "1f991ac3b4b283ebf96e60ae23a00a52765dd3a2e46fa6fdda9f1aab032f7495",
    ),
    "vendor/xterm.css": (
        "vendor/xterm/xterm.css", "ba8e6985669488981ccf40c0cefe3aba80722cb6c92de7ad628b0bd717faf2b6",
    ),
}


def copy(origin, target, expected=None):
    if expected and hashlib.sha256(origin.read_bytes()).hexdigest() != expected:
        raise ValueError(f"Changed input {origin.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(origin, target)


def native_page(native):
    markup = (WEB / "run.html").read_text(encoding="utf-8")
    scripts = []

    def external(match):
        name = f"run-{len(scripts) + 1}.js"
        scripts.append(name)
        code = match[1]
        if "function addSerial(" in code:
            old = "  while (lines.length > 2000) lines.shift();\n  render();"
            if code.count(old) != 1:
                raise ValueError("The upstream UART renderer changed.")
            code = code.replace(old, old + "\n  if (src === 'uart0') window.dispatchEvent(new Event('esp32lab-uart'));")
        (native / name).write_text(code, encoding="utf-8")
        return f'<script src="{name}"></script>'

    markup = re.sub(r"<script>(.*?)</script>", external, markup, flags=re.DOTALL)
    if len(scripts) != 3 or markup.count("</body>") != 1 or re.search(r'\son\w+="', markup):
        raise ValueError("Unexpected inline code in the upstream emulator page.")
    markup = markup.replace("</body>", '<script src="uart.js"></script>\n</body>')
    (native / "run.html").write_text(markup, encoding="utf-8")
    copy(INTEGRATION / "uart.js", native / "uart.js")
    emu = (WEB / "emu.js").read_text(encoding="utf-8")
    if emu.count("'esp32_rev300_rom.elf'") != 1:
        raise ValueError("The compatible ESP32 ROM lookup changed.")
    (native / "emu.js").write_text(emu.replace("'esp32_rev300_rom.elf'", "'esp32_rev300_rom.data'"), encoding="utf-8")


def native_assets(native, inputs):
    for filename, (relative, expected) in INPUTS.items():
        copy(inputs / filename, native / relative, expected)
    for relative in (
        "terminal.js", "touch-input.js", "workbench.js", "workbench.css", "netmon.js",
        "wasm/worker.js", "wasm/jit.mjs", "wasm/pacing.mjs", "wasm/experiments.mjs",
        "assets/esp32sim-logo-icon.png", "assets/demo-tdisplay.webp",
    ):
        copy(WEB / relative, native / relative)
    for directory, extension in (("assets/atech", ".webp"), ("vendor/dpkt-js", ".js")):
        for path in sorted((WEB / directory).glob("*" + extension)):
            copy(path, native / path.relative_to(WEB))
    preset = WEB / "wasm/fw/tdisplay-prices.json"
    manifest = json.loads(preset.read_text())
    manifest["files"]["rom"] = "esp32_rev300_rom.data"
    manifest["flash_at"] = {offset: str(Path(value).with_suffix(".data")) for offset, value in manifest["flash_at"].items()}
    (native / preset.relative_to(WEB)).write_text(json.dumps(manifest, indent=2) + "\n")
    demos = json.loads((preset.parent / "demos.json").read_text())
    chosen, = [item for item in demos if item["fw"] == "tdisplay-prices"]
    (native / "wasm/fw/demos.json").write_text(json.dumps([chosen], indent=2) + "\n")
    demo = "wasm/fw/public/tdisplay-vfs"
    copy(WEB / (demo + ".bin"), native / (demo + ".data"),
         "d31b091077b6ce8082a401da6d14e3ea0f70ad735e4d359773959ecdd7d22278")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.output
    root.mkdir(parents=True, exist_ok=False)
    native = root / "native"
    native.mkdir()
    native_page(native)
    native_assets(native, args.inputs)
    copy(INTEGRATION / "mount.mjs", root / "index.mjs")
    for name in ("project.mjs", "workspace.css"):
        copy(INTEGRATION / name, root / name)
    legal = root / "legal"
    shutil.copytree(INTEGRATION / "legal", legal)
    copy(APP / "LICENSE", legal / "esp32sim-MIT.txt")
    copy(WEB / "vendor/dpkt-js/LICENSE", legal / "dpkt-js-LICENSE.txt")
    copy(args.inputs / "vendor/LICENSE", legal / "xterm-MIT.txt",
         "b569f629d00f2626a8100df2a1798210535621e42164dfd426a6fe5aac7b0ccd")
    for name in ("tdisplay-NOTICE", "wifi-station-NOTICE"):
        copy(WEB / f"wasm/fw/public/{name}.txt", legal / f"{name}.txt")
    assets = sorted(file.relative_to(root).as_posix() for directory in (native, legal)
                    for file in directory.rglob("*") if file.is_file())
    (root / "app.json").write_text(json.dumps({"assets": assets}, indent=2) + "\n")


if __name__ == "__main__":
    main()

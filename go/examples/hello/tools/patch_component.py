#!/usr/bin/env python3
"""Binary patches for the TinyGo wasip2 core module (see build.sh).

Subcommands:

  extract <component.wasm> <core.wasm>
      Unwrap the core module from the component TinyGo emits and drop the
      `arc4random_buf` export (a libc-compat symbol from TinyGo's syscall
      package that calls wasi:random get-random-bytes; the perfscale engine
      never calls it). Once unreferenced, `wasm-opt
      --remove-unused-module-elements` can delete the function and the
      get-random-bytes import entirely.

  rename-random <core.wasm> <out.wasm>
      Rewrite the remaining `wasi:random/random@0.2.0 get-random-u64` import
      as `wasi:clocks/monotonic-clock@0.2.0 now` (identical canonical
      signature `() -> u64`). TinyGo's runtime calls it once at startup to
      seed its internal PRNG; a clock draw is fine for that, and the engine
      hard-rejects wasi:random imports. Only the import section's module/name
      strings are rewritten, so no function indices change.

Stdlib only; no third-party Python packages.
"""

import sys

RANDOM_MODULE = b"wasi:random/random@0.2.0"
CLOCK_MODULE = b"wasi:clocks/monotonic-clock@0.2.0"


def leb(buf, pos):
    v = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        v |= (b & 0x7F) << shift
        shift += 7
        if not (b & 0x80):
            return v, pos


def uleb(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def name(buf, pos):
    n, pos = leb(buf, pos)
    return bytes(buf[pos : pos + n]), pos + n


def sections(data):
    assert data[:4] == b"\x00asm", "not a wasm binary"
    pos = 8
    while pos < len(data):
        sid = data[pos]
        start = pos
        pos += 1
        size, pos = leb(data, pos)
        yield sid, start, pos, pos + size
        pos += size


def splice(data, start, end, payload):
    return bytes(data[:start]) + payload + bytes(data[end:])


def parse_imports(data, sec_start):
    pos = sec_start
    count, pos = leb(data, pos)
    entries = []
    for _ in range(count):
        mod, pos = name(data, pos)
        nm, pos = name(data, pos)
        desc_pos = pos
        kind = data[pos]
        pos += 1
        if kind == 0:  # func: type index
            _, pos = leb(data, pos)
        elif kind == 1:  # table: elemtype + limits
            pos += 1
            flags, pos = leb(data, pos)
            _, pos = leb(data, pos)
            if flags & 1:
                _, pos = leb(data, pos)
        elif kind == 2:  # memory: limits
            flags, pos = leb(data, pos)
            _, pos = leb(data, pos)
            if flags & 1:
                _, pos = leb(data, pos)
        elif kind == 3:  # global: valtype + mutability
            pos += 2
        elif kind == 4:  # tag: attribute + type index
            _, pos = leb(data, pos)
            _, pos = leb(data, pos)
        else:
            raise SystemExit(f"unknown import kind {kind}")
        entries.append((mod, nm, bytes(data[desc_pos:pos])))
    return count, entries


def rebuild_import_section(entries):
    out = bytearray(uleb(len(entries)))
    for mod, nm, desc in entries:
        out += uleb(len(mod)) + mod + uleb(len(nm)) + nm + desc
    return b"\x02" + uleb(len(out)) + bytes(out)


def extract(component_path, out_path):
    data = bytearray(open(component_path, "rb").read())
    core = None
    for sid, start, sec_start, sec_end in sections(data):
        if sid == 1:  # component "core module" section
            core = bytes(data[sec_start:sec_end])
            break
    if core is None or core[:4] != b"\x00asm":
        raise SystemExit("no core module found in component")

    # Drop the arc4random_buf export from the core module's export section.
    for sid, start, sec_start, sec_end in sections(core):
        if sid != 7:
            continue
        pos = sec_start
        count, pos = leb(core, pos)
        kept = bytearray()
        removed = 0
        for _ in range(count):
            nm, pos = name(core, pos)
            kind = core[pos]
            pos += 1
            idx, pos = leb(core, pos)
            if nm == b"arc4random_buf":
                removed += 1
                continue
            kept += uleb(len(nm)) + nm + bytes([kind]) + uleb(idx)
        if removed != 1:
            raise SystemExit(f"expected 1 arc4random_buf export, found {removed}")
        payload = uleb(count - 1) + bytes(kept)
        core = splice(core, start, sec_end, b"\x07" + uleb(len(payload)) + payload)
        break
    else:
        raise SystemExit("no export section found")

    open(out_path, "wb").write(core)


def rename_random(core_path, out_path):
    data = bytearray(open(core_path, "rb").read())
    for sid, start, sec_start, sec_end in sections(data):
        if sid != 2:
            continue
        _, entries = parse_imports(data, sec_start)
        patched = 0
        new_entries = []
        for mod, nm, desc in entries:
            if mod == RANDOM_MODULE:
                if nm != b"get-random-u64":
                    raise SystemExit(
                        f"unexpected wasi:random import {nm!r}; run wasm-opt "
                        "--remove-unused-module-elements first (see build.sh)"
                    )
                mod, nm = CLOCK_MODULE, b"now"
                patched += 1
            new_entries.append((mod, nm, desc))
        if patched != 1:
            raise SystemExit(f"expected 1 wasi:random import, found {patched}")
        data = splice(data, start, sec_end, rebuild_import_section(new_entries))
        open(out_path, "wb").write(data)
        return
    raise SystemExit("no import section found")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("extract", "rename-random"):
        sys.exit(__doc__)
    if sys.argv[1] == "extract":
        extract(sys.argv[2], sys.argv[3])
    else:
        rename_random(sys.argv[2], sys.argv[3])

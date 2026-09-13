#!/usr/bin/env python3
"""重新生成发布包 xin-ideas.zip（内含整个 xin-ideas/ skill 目录）。

用法：在仓库根目录执行  python scripts/build_zip.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "xin-ideas")
ZIP_PATH = os.path.join(ROOT, "xin-ideas.zip")


def build() -> None:
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _, files in os.walk(SKILL_DIR):
            for name in files:
                full = os.path.join(dirpath, name)
                arc = os.path.relpath(full, ROOT)
                zf.write(full, arc)
    print(f"built {os.path.relpath(ZIP_PATH, ROOT)}")


if __name__ == "__main__":
    build()
"""把项目打包成 ZIP 备份（排除 node_modules 等可再生目录）。

用法：
  python scripts/zip_project.py <输出zip路径> [--root 压缩包内根名]

默认排除：node_modules、.vite 缓存、*.log
"""
import os
import sys
import zipfile

EXCLUDE_DIRS = {"node_modules", ".vite", ".turbo", ".cache"}
EXCLUDE_FILES = {".DS_Store"}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else None
    if not out:
        print("usage: python scripts/zip_project.py <out.zip>")
        return 1

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    arc_root = "face-studio"

    total = 0
    kept = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in EXCLUDE_DIRS and not (d == ".git" and False)
            ]
            # 相对路径（用于判断是否在排除目录内）
            rel = os.path.relpath(dirpath, root).replace("\\", "/")
            if rel != "." and any(p in EXCLUDE_DIRS for p in rel.split("/")):
                continue
            # 空目录也保留
            if not filenames and not dirnames:
                arc = f"{arc_root}/{rel}/" if rel != "." else f"{arc_root}/"
                z.writestr(zipfile.ZipInfo(arc), b"")
            for fn in filenames:
                if fn in EXCLUDE_FILES or fn.endswith(".log"):
                    continue
                src = os.path.join(dirpath, fn)
                arc = f"{arc_root}/{rel}/{fn}" if rel != "." else f"{arc_root}/{fn}"
                try:
                    z.write(src, arc)
                    kept += 1
                    total += os.path.getsize(src)
                except (OSError, PermissionError) as e:
                    print(f"skip {src}: {e}")

    size = os.path.getsize(out)
    print(f"files={kept}  raw={total/1048576:.1f}MB  zip={size/1048576:.1f}MB")
    print(f"out={out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

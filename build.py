"""Builds the desktop app with PyInstaller.

    python build.py

Output: dist/Socratic Debugger/ (the app) and a .zip of it, ready to upload.
Build on Windows for a Windows app and on macOS for a Mac app.
"""
import os
import shutil
import sys

import PyInstaller.__main__

NAME = "Socratic Debugger"

# The packaged app only contains modules it imports itself, so list the standard
# library modules beginners commonly use, or their programs would fail to import them.
STUDENT_MODULES = [
    "array", "bisect", "calendar", "collections", "copy", "csv", "dataclasses", "datetime",
    "decimal", "enum", "fractions", "functools", "heapq", "itertools", "json", "math",
    "operator", "pprint", "random", "re", "statistics", "string", "textwrap", "time",
    "typing", "unittest", "uuid",
]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)

    if sys.platform == "win32":
        icon, platform = "static/icons/app.ico", "windows"
    elif sys.platform == "darwin":
        icon, platform = "static/icons/icon-1024.png", "macos"
    else:
        icon, platform = "static/icons/icon-512.png", "linux"

    args = [
        "desktop.py",
        "--name", NAME,
        "--windowed",
        "--noconfirm",
        "--clean",
        "--icon", icon,
        "--add-data", f"templates{os.pathsep}templates",
        "--add-data", f"static{os.pathsep}static",
    ]
    for module in STUDENT_MODULES:
        args += ["--hidden-import", module]

    PyInstaller.__main__.run(args)

    # macOS builds a .app bundle; Windows and Linux build a folder.
    source = f"{NAME}.app" if platform == "macos" else NAME
    archive = shutil.make_archive(os.path.join("dist", f"Socratic-Debugger-{platform}"), "zip",
                                  root_dir="dist", base_dir=source)
    print(f"\nBuilt {os.path.join('dist', source)}\nZipped to {archive}")


if __name__ == "__main__":
    main()

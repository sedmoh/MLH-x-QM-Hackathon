# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['desktop.py'],
    pathex=[],
    binaries=[],
    datas=[('templates', 'templates'), ('static', 'static')],
    hiddenimports=['array', 'bisect', 'calendar', 'collections', 'copy', 'csv', 'dataclasses', 'datetime', 'decimal', 'enum', 'fractions', 'functools', 'heapq', 'itertools', 'json', 'math', 'operator', 'pprint', 'random', 're', 'statistics', 'string', 'textwrap', 'time', 'typing', 'unittest', 'uuid'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Socratic Debugger',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['static/icons/app.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Socratic Debugger',
)

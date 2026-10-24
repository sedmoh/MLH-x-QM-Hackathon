"""Paths and helpers shared by the web app and the packaged desktop app."""
import os
import sys

# True inside an app built with PyInstaller.
FROZEN = getattr(sys, "frozen", False)

# PyInstaller unpacks templates/ and static/ to sys._MEIPASS; otherwise they sit next to this file.
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _user_data_dir():
    if sys.platform == "win32":
        root = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Application Support")
    else:
        root = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(root, "Socratic Debugger")


# Where the API key (.env) lives: the project folder when developing,
# the user's app-data folder when installed, so the key is never bundled.
DATA_DIR = _user_data_dir() if FROZEN else BASE_DIR

# A packaged app has no separate python.exe, so it re-launches itself
# with this flag to run a student's program.
RUN_FLAG = "--run-student-code"


def python_command(script_path):
    if FROZEN:
        return [sys.executable, RUN_FLAG, script_path]
    return [sys.executable, script_path]


def run_student_code(path):
    """Runs a student's script like `python main.py` would, inside the packaged app."""
    import runpy
    import traceback

    path = os.path.abspath(path)
    sys.argv = [path]
    sys.path.insert(0, os.path.dirname(path))
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")

    try:
        runpy.run_path(path, run_name="__main__")
    except SystemExit:
        raise
    except BaseException as exc:
        # Hide the launcher's own frames so the traceback starts at the student's code.
        tb = exc.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename != path:
            tb = tb.tb_next
        traceback.print_exception(type(exc), exc, tb)
        sys.exit(1)

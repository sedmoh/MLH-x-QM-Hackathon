"""Desktop entry point: runs the app in its own window instead of a browser tab."""
import os
import sys
import threading
import webbrowser

from runtime import DATA_DIR, FROZEN, RUN_FLAG, run_student_code


def redirect_output_to_log():
    # A windowed app has no console, so send print() and server logs to a file.
    os.makedirs(DATA_DIR, exist_ok=True)
    log = open(os.path.join(DATA_DIR, "app.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = log


def main():
    # The app re-launches itself with RUN_FLAG to run a student's program (see runtime.py).
    if len(sys.argv) >= 3 and sys.argv[1] == RUN_FLAG:
        run_student_code(sys.argv[2])
        return

    if FROZEN and (sys.stdout is None or sys.stderr is None):
        redirect_output_to_log()

    from werkzeug.serving import make_server

    from app import app

    # Port 0 picks any free port, so the app never clashes with something else on this machine.
    server = make_server("127.0.0.1", 0, app, threaded=True)
    url = f"http://127.0.0.1:{server.server_port}/"

    try:
        import webview
    except ImportError:
        webview = None

    if webview is None:
        print("pywebview is not installed, opening the browser instead.")
        webbrowser.open(url)
        server.serve_forever()
        return

    threading.Thread(target=server.serve_forever, daemon=True).start()
    webview.create_window("Socratic Debugger", url, width=1280, height=860, min_size=(420, 600))
    # private_mode=False keeps localStorage (the light/dark choice) between launches.
    webview.start(private_mode=False, storage_path=os.path.join(DATA_DIR, "webview"))
    server.shutdown()


if __name__ == "__main__":
    main()

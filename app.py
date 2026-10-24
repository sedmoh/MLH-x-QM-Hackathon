import os
import shutil
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__)

MODEL = "gemma-4-26b-a4b-it"

MAX_CODE_LENGTH = 20_000

use_minimal_thinking = True

SYSTEM_INSTRUCTION = """You are a patient Socratic debugging tutor for beginner Python students.
Your goal is to help the student find and fix the bug themselves.

Strict rules:
- Never write corrected code. Never show a fixed line, a fixed snippet, or a diff.
- Never quote the student's code back with the fix applied.
- Ask only one guiding question at a time.
- Keep your reply short: two or three sentences at most.
- Be friendly and encouraging."""

HINT_LEVELS = {
    1: "Ask ONE guiding question that makes the student think about what went wrong. "
       "Do not say where the bug is.",
    2: "Point the student to the area of the code where the problem is "
       "(for example the line number or the function name), then ask ONE question about it. "
       "Do not say what the fix is.",
    3: "Explain the underlying Python concept the student needs to understand to fix this bug, "
       "in plain words, then ask ONE question so they can apply it. "
       "Still do not write the corrected code.",
}


def run_python(code):
    folder = tempfile.mkdtemp()
    with open(os.path.join(folder, "main.py"), "w", encoding="utf-8") as f:
        f.write(code)
    # Force UTF-8 so printing non-ASCII text works the same on Windows.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    try:
        result = subprocess.run(
            [sys.executable, "main.py"], check=False, cwd=folder, capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=5, env=env,
        )
        # Show "main.py" in tracebacks instead of the temporary folder path.
        script_path = os.path.join(folder, "main.py")
        return {
            "stdout": result.stdout,
            "stderr": result.stderr.replace(script_path, "main.py"),
            "returncode": result.returncode,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": "Your program ran for more than 5 seconds and was stopped. "
                      "Is there an infinite loop?",
            "returncode": None,
            "timed_out": True,
        }
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def ask_gemma(code, error_output, level):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    prompt = f"""Here is the student's Python code:

{code}

Here is the real output when it ran (stdout and stderr):

{error_output or "(no output)"}

Hint level {level} of 3. {HINT_LEVELS[level]}"""

    global use_minimal_thinking
    start = time.time()

    if use_minimal_thinking:
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    thinking_config=types.ThinkingConfig(thinking_level="MINIMAL"),
                ),
            )
            print(f"Hint level {level} took {time.time() - start:.1f}s (minimal thinking)")
            return response.text or ""
        except Exception as e:
            if "think" not in str(e).lower():
                raise
            print("Gemma rejected the thinking setting, asking normally instead.")
            use_minimal_thinking = False

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
    )
    print(f"Hint level {level} took {time.time() - start:.1f}s")
    return response.text or ""


def read_code(data):
    code = data.get("code", "")
    if not isinstance(code, str) or not code.strip():
        return None, "Please paste some Python code first."
    if len(code) > MAX_CODE_LENGTH:
        return None, f"Your code is too long. Please keep it under {MAX_CODE_LENGTH:,} characters."
    return code, None


@app.route("/")
def index():
    return render_template("index.html")


# Browsers request /favicon.ico at the site root even without a <link> tag.
@app.route("/favicon.ico")
def favicon():
    return send_from_directory(os.path.join(app.static_folder, "icons"), "favicon.ico")


@app.route("/site.webmanifest")
def manifest():
    return send_from_directory(app.static_folder, "site.webmanifest",
                               mimetype="application/manifest+json")


@app.route("/run", methods=["POST"])
def run():
    data = request.get_json(silent=True) or {}
    code, error = read_code(data)
    if error:
        return jsonify({"error": error}), 400
    return jsonify(run_python(code))


@app.route("/hint", methods=["POST"])
def hint():
    data = request.get_json(silent=True) or {}
    code, error = read_code(data)
    if error:
        return jsonify({"error": error}), 400

    output = data.get("output", "")
    if not isinstance(output, str):
        output = ""
    try:
        level = int(data.get("level", 1))
    except (TypeError, ValueError):
        level = 1
    level = max(1, min(level, 3))

    if not os.environ.get("GEMINI_API_KEY"):
        return jsonify({"error": "GEMINI_API_KEY is not set on the server."}), 500

    try:
        text = ask_gemma(code, output, level)
    except Exception as e:
        print("Gemma error:", e, file=sys.stderr)
        return jsonify({"error": "Could not get a hint from Gemma: " + str(e)}), 500

    if not text.strip():
        return jsonify({"error": "Gemma returned an empty hint. Please try again."}), 502

    return jsonify({"hint": text.strip(), "level": level})


if __name__ == "__main__":
    app.run(debug=True, port=5001)

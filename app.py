import os
import shutil
import subprocess
import sys
import tempfile
import time

from flask import Flask, jsonify, render_template, request
from google import genai
from google.genai import types

app = Flask(__name__)

MODEL = "gemma-4-26b-a4b-it"

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
    with open(os.path.join(folder, "main.py"), "w") as f:
        f.write(code)
    try:
        result = subprocess.run(
            ["python3", "main.py"], cwd=folder, capture_output=True, text=True, timeout=5
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": "Your program ran for more than 5 seconds and was stopped. "
                      "Is there an infinite loop?",
            "timed_out": True,
        }
    finally:
        shutil.rmtree(folder)


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
            return response.text
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
    return response.text


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/run", methods=["POST"])
def run():
    code = request.json.get("code", "")
    return jsonify(run_python(code))


@app.route("/hint", methods=["POST"])
def hint():
    code = request.json.get("code", "")
    output = request.json.get("output", "")
    level = int(request.json.get("level", 1))
    level = max(1, min(level, 3))

    if "GEMINI_API_KEY" not in os.environ:
        return jsonify({"error": "GEMINI_API_KEY is not set on the server."}), 500

    try:
        text = ask_gemma(code, output, level)
    except Exception as e:
        print("Gemma error:", e, file=sys.stderr)
        return jsonify({"error": "Could not get a hint from Gemma: " + str(e)}), 500

    return jsonify({"hint": text, "level": level})


if __name__ == "__main__":
    app.run(debug=True, port=5001)

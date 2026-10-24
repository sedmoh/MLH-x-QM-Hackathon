import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory
from google import genai
from google.genai import errors, types

# Read GEMINI_API_KEY from a local .env file if there is one. Never upload .env to GitHub.
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(ENV_FILE)

app = Flask(__name__)
# Refuse uploads bigger than 10 MB.
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

MODEL = "gemma-4-26b-a4b-it"

MAX_CODE_LENGTH = 20_000

# How many times to ask for a new hint if the leak checker says the hint gives too much away.
MAX_RETRIES = 2

SYSTEM_INSTRUCTION = """You are a Socratic debugging tutor for beginner Python students.
Your goal is to help the student find and fix the bug themselves.

Strict rules:
- Never write corrected code. Never show a fixed line, a fixed snippet, or a diff.
- Never describe the fix in words either (for example "change X to Y" or "use += instead").
- Never start with praise or encouragement such as "great start" or "great job".
  Go straight to the hint.
- Ask only one guiding question per hint.
- Keep your reply short: two or three sentences at most.
- Each hint must add something new compared to the earlier hints. Do not repeat them.
- If the student attached a screenshot, mention what you see in it only as a question
  or a pointer (for example "What does the red message at the bottom say?"), never the fix."""

# What the tutor is allowed to do at each step of the hint ladder.
HINT_LEVELS = {
    1: "Ask ONE general question about what the code is doing. "
       "Do NOT name the specific variable, line, or value that is wrong.",
    2: "Point to the specific line or the specific operation where the problem is. You may ask "
       "the student to look at the type of error in the error message. Ask ONE question. "
       "Do NOT name the exact fix or say what the corrected code should be.",
    3: "Explain the underlying Python concept in plain words, then ask ONE question. "
       "Do NOT say how to fix this exact code.",
}

LEAK_CHECK_INSTRUCTION = """You are a strict checker for hints written by a debugging tutor for beginners.
First work out what the bug and its fix are. Then decide if the hint gives too much away.
Be strict: if in doubt, answer YES.

For level 1 and level 3 hints, answer YES if ANY of these are true:
- The hint contains corrected code, or describes the fix in words.
- The hint asks a question whose answer is the fix, for example
  "How can you change that line so the number is added to total?"
- Level 1 only: the hint names a specific variable, line, or value
  (for example "the name variable", "line 3", or "alice vs Alice").
- Level 3 only: the hint says how to fix this exact code instead of explaining the idea.

For level 2 hints, be more relaxed. A level 2 hint IS allowed to point to the specific line
or the specific operation, and to ask the student to look at the type of error in the
error message. Answer YES for a level 2 hint ONLY if it states or clearly implies the
replacement code or the exact change to make (for example "wrap age in str()" or
"use += instead of =").

Otherwise answer NO.

Reply in exactly this format, two short lines:
FIX: <the fix in a few words>
VERDICT: YES or NO"""

# Used only if every attempt leaks, so the student never sees a leaking hint.
SAFE_HINTS = {
    1: "Try adding a print() inside your code to see what your variables hold at each step. "
       "What do you notice?",
    2: "Pick the line where things first go wrong and predict, on paper, what it should do. "
       "Does the program agree with your prediction?",
    3: "Think about what each operation on that line really does in Python. "
       "Which part behaves differently from what you expected?",
}

SCREENSHOT_NOTE = """

The student also attached a screenshot of their error or code (the image above).
Use it to understand the problem, but mention what you see in it only as a question
or a pointer, never as the fix."""

EXTRACT_INSTRUCTION = """Transcribe the Python code visible in this image exactly as written, \
character for character, including any mistakes or bugs. Do not fix, improve, or comment on it. \
Output only the code, nothing else. If there is no code in the image, output exactly NO_CODE."""

EXTRACT_SYSTEM = "You copy text out of images exactly as it appears."

client = None
client_key = None


def get_client():
    """Create the Gemma client the first time it's needed, then reuse it.

    A new client is made if the API key in .env has changed since.
    """
    global client, client_key
    key = os.environ["GEMINI_API_KEY"]
    if client is None or key != client_key:
        client = genai.Client(api_key=key)
        client_key = key
    return client


def have_api_key():
    """Re-read .env so a replaced API key works without restarting, then check there is one."""
    load_dotenv(ENV_FILE, override=True)
    return bool(os.environ.get("GEMINI_API_KEY"))


NO_KEY_MESSAGE = "GEMINI_API_KEY is not set on the server."


def call_gemma(system_instruction, prompt, screenshot=None):
    """Send one message to Gemma and return its reply as text.

    screenshot is optional: {"uri": ..., "mime_type": ...} from an earlier upload.
    """
    contents = prompt
    if screenshot:
        image = types.Part.from_uri(file_uri=screenshot["uri"], mime_type=screenshot["mime_type"])
        contents = [image, prompt]
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        # Tell Gemma to think as little as possible before answering. Much faster.
        # (This model rejects other levels like "LOW".)
        thinking_config=types.ThinkingConfig(thinking_level="MINIMAL"),
    )
    # Google's servers sometimes fail for a moment (500 INTERNAL, 503 UNAVAILABLE).
    # Wait a little and try again, up to 3 tries in total, before giving up.
    for attempt in range(3):
        try:
            response = get_client().models.generate_content(
                model=MODEL, contents=contents, config=config,
            )
            return response.text or ""  # response.text can be None if Gemma sends nothing back
        except errors.ServerError as e:
            if attempt == 2:
                raise
            print(f"Gemma server error ({e.code}), trying again in {attempt + 1}s...")
            time.sleep(attempt + 1)


def hide_temp_folder(text, folder):
    """Turn the long temp path in error messages into just main.py."""
    # On a Mac the folder can show up as /var/... or /private/var/..., so replace both.
    for path in (os.path.realpath(folder), folder):
        text = text.replace(os.path.join(path, "main.py"), "main.py")
    return text


def run_python(code):
    """Run the student's code with Python and return what it printed."""
    # Save the code as main.py in a throwaway folder.
    folder = tempfile.mkdtemp()
    script_path = os.path.join(folder, "main.py")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(code)
    # Force UTF-8 so printing non-ASCII text works the same on Windows.
    # PYTHON_COLORS=0 stops Python 3.13+ adding colour codes to tracebacks
    # when the server's shell sets FORCE_COLOR.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "PYTHON_COLORS": "0"}
    try:
        # sys.executable is the same Python that runs this app, on any computer.
        # stdin=DEVNULL so input() fails fast instead of reading the server's terminal.
        result = subprocess.run(
            [sys.executable, script_path], check=False, cwd=folder, capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", timeout=5, env=env,
        )
        return {
            "stdout": result.stdout,
            "stderr": hide_temp_folder(result.stderr, folder),
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


def hint_leaks(code, level, hint, screenshot=None):
    """Ask Gemma whether a hint gives away too much. Returns True if it does."""
    # The checker sees the screenshot too, since the bug might only be visible there.
    prompt = f"""Student's code:

{code}

Hint level {level} of 3. At this level the hint is allowed to: {HINT_LEVELS[level]}

The hint:

{hint}

Does this hint give away more than level {level} allows, contain corrected code,
or state the direct fix? Use the FIX / VERDICT format."""
    if screenshot:
        prompt += "\n\nThe student also attached a screenshot (the image above)."
    # The checker writes out the fix first, so it knows what a leak would look like.
    reply = call_gemma(LEAK_CHECK_INSTRUCTION, prompt, screenshot)
    # Only look at the part after "VERDICT:", so a "no" inside the FIX line can't confuse it.
    verdict = reply.upper().split("VERDICT:")[-1]
    # Use the last YES or NO in the reply. If there is neither, play it safe and count it as a leak.
    words = re.findall(r"\b(YES|NO)\b", verdict)
    leaks = not words or words[-1] == "YES"
    print(f"Leak check: level {level} -> {'YES (leaks)' if leaks else 'NO (ok)'}")
    if leaks:
        # Show the checker's reasoning, so you can see why it rejected the hint.
        fix_line = re.search(r"FIX:\s*(.*)", reply, re.IGNORECASE)
        reason = fix_line.group(1).strip() if fix_line else "(no FIX line in reply: " + reply.strip()[:100] + ")"
        print(f"    rejected hint: {hint}")
        print(f"    checker's FIX: {reason}")
    return leaks


def ask_gemma(code, error_output, level, previous_hints, screenshot=None):
    """Ask Gemma for one hint at the given level, checking it doesn't give away the fix."""
    earlier = "\n".join(f"- {h}" for h in previous_hints) or "(none yet)"

    prompt = f"""Here is the student's Python code:

{code}

Here is the real output when it ran (stdout and stderr):

{error_output or "(no output)"}

Hints the student has already seen:
{earlier}

Hint level {level} of 3. {HINT_LEVELS[level]}"""
    if screenshot:
        prompt += SCREENSHOT_NOTE
    else:
        prompt += "\n\nBase your hint only on the code and the real output above."

    start = time.time()
    for attempt in range(1 + MAX_RETRIES):
        hint = call_gemma(SYSTEM_INSTRUCTION, prompt, screenshot).strip()
        if not hint_leaks(code, level, hint, screenshot):
            print(f"Hint level {level} took {time.time() - start:.1f}s ({attempt + 1} attempt(s))")
            return hint
        # Ask again, and tell Gemma what went wrong last time.
        prompt += f"""

Your last hint gave away too much: "{hint}"
Write a new hint that is LESS direct and follows the level {level} rule strictly."""

    print(f"Hint level {level}: every attempt leaked, using a safe fallback hint.")
    return SAFE_HINTS[level]


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


def read_code(data, allow_empty=False):
    """Get the code from a request, checking it is text and not too long."""
    code = data.get("code", "")
    if not isinstance(code, str):
        return None, "Your code could not be read. Please paste it again."
    if not code.strip() and not allow_empty:
        return None, "Please paste some Python code first."
    if len(code) > MAX_CODE_LENGTH:
        return None, f"Your code is too long. Please keep it under {MAX_CODE_LENGTH:,} characters."
    return code, None


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
    screenshot = data.get("screenshot")  # None if no screenshot was uploaded
    # An empty code box is only OK when there is a screenshot to give hints from.
    code, error = read_code(data, allow_empty=bool(screenshot))
    if error:
        return jsonify({"error": error}), 400

    output = data.get("output", "")
    if not isinstance(output, str):
        output = ""
    try:
        level = int(data.get("level", 1))
    except (TypeError, ValueError):
        level = 1
    level = max(1, min(level, 3))  # keep it between 1 and 3
    previous_hints = [h for h in data.get("previous_hints", []) if isinstance(h, str)]
    # If there is code in the box, it has been run, so the code and its real output are
    # better evidence than a picture. Only use the screenshot when the box is empty.
    if code.strip():
        screenshot = None

    if not have_api_key():
        return jsonify({"error": NO_KEY_MESSAGE}), 500

    # First try with the screenshot. If that fails, carry on without it.
    image_error = None
    if screenshot:
        try:
            text = ask_gemma(code, output, level, previous_hints, screenshot)
            return jsonify({"hint": text, "level": level})
        except Exception as e:
            print("Gemma image error:", e, file=sys.stderr)
            image_error = "Gemma couldn't use your screenshot, so this hint is based on your code only."

    try:
        text = ask_gemma(code, output, level, previous_hints)
    except Exception as e:
        print("Gemma error:", e, file=sys.stderr)
        return jsonify({"error": "Could not get a hint from Gemma: " + str(e)}), 500

    if not text.strip():
        return jsonify({"error": "Gemma returned an empty hint. Please try again."}), 502

    return jsonify({"hint": text, "level": level, "image_error": image_error})


def strip_code_fences(text):
    """Remove ```python ... ``` marks that Gemma sometimes wraps code in."""
    text = re.sub(r"^\s*```[\w+-]*[ \t]*\n", "", text)  # opening ``` line
    text = re.sub(r"\n?```\s*$", "", text)               # closing ```
    # Drop blank lines at the start and spaces at the end, but keep the first line's indent.
    return text.lstrip("\n").rstrip()


@app.route("/extract", methods=["POST"])
def extract():
    """Read the Python code out of an uploaded screenshot, bugs and all."""
    screenshot = (request.get_json(silent=True) or {}).get("screenshot")
    if not screenshot:
        return jsonify({"error": "Choose a screenshot first."}), 400

    if not have_api_key():
        return jsonify({"error": NO_KEY_MESSAGE}), 500

    try:
        # Not the tutor's system instruction: here we want the code copied exactly.
        reply = call_gemma(EXTRACT_SYSTEM, EXTRACT_INSTRUCTION, screenshot)
    except Exception as e:
        print("Extract error:", e, file=sys.stderr)
        return jsonify({"error": f"Could not read code from your screenshot ({e})."}), 500

    code = strip_code_fences(reply)
    if code.strip() == "NO_CODE":
        print("Extract: no code found in the screenshot")
        return jsonify({"no_code": True})
    print(f"Extract: copied {len(code.splitlines())} line(s) of code from the screenshot")
    return jsonify({"code": code})


@app.route("/upload", methods=["POST"])
def upload():
    """Upload the student's screenshot to Google so Gemma can look at it."""
    image = request.files.get("screenshot")
    if image is None or image.mimetype not in ("image/png", "image/jpeg"):
        return jsonify({"error": "Please choose a PNG or JPG image."}), 400

    if not have_api_key():
        return jsonify({"error": NO_KEY_MESSAGE}), 500

    # Save it to a temporary file, upload that, then delete it.
    suffix = ".png" if image.mimetype == "image/png" else ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        image.save(f)
        path = f.name
    try:
        uploaded = get_client().files.upload(file=path, config={"mime_type": image.mimetype})
        print(f"Uploaded screenshot as {uploaded.name}")
        return jsonify({"uri": uploaded.uri, "mime_type": uploaded.mime_type})
    except Exception as e:
        print("Upload error:", e, file=sys.stderr)
        return jsonify({"error": f"Could not upload your screenshot ({e})."}), 500
    finally:
        os.remove(path)


if __name__ == "__main__":
    # Port 5000 is taken by AirPlay on Macs, so use 5001.
    # Debug mode is off: no Debugger PIN, and errors never show a code console in the browser.
    app.run(debug=False, port=5001)

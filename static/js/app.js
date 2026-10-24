(function () {
  "use strict";

  const MAX_LEVEL = 3;
  const LEVEL_NAMES = { 1: "Nudge", 2: "Location", 3: "Concept" };

  const EXAMPLE = [
    "def average(numbers):",
    "    total = 0",
    "    for n in numbers:",
    "        total += n",
    "    return total / len(number)",
    "",
    "scores = [72, 85, 90, 64]",
    'print("Average score:", average(scores))',
    "",
  ].join("\n");

  const els = {
    code: document.getElementById("code"),
    gutter: document.getElementById("gutter"),
    helpBtn: document.getElementById("helpBtn"),
    stuckBtn: document.getElementById("stuckBtn"),
    resetBtn: document.getElementById("resetBtn"),
    exampleBtn: document.getElementById("exampleBtn"),
    status: document.getElementById("status"),
    output: document.getElementById("output"),
    runState: document.getElementById("runState"),
    hints: document.getElementById("hints"),
    steps: document.querySelectorAll(".steps li"),
  };

  let level = 0;
  let lastOutput = "";
  let lastRunCode = null;
  let busy = false;

  /* ---------- Networking ---------- */

  async function postJson(url, data) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (err) {
      return { error: "Couldn't reach the server. Is it still running?" };
    }

    try {
      return await res.json();
    } catch (err) {
      return { error: "The server sent back an unexpected response (" + res.status + ")." };
    }
  }

  /* ---------- Actions ---------- */

  async function helpMe() {
    if (busy) return;
    const code = els.code.value;
    if (!code.trim()) {
      setStatus("");
      clearHints();
      showNotice("Please paste some Python code first.");
      els.code.focus();
      return;
    }

    setBusy(true);
    clearHints();
    level = 0;
    updateSteps();

    const ran = await runCode(code);
    if (ran) {
      level = 1;
      await getHint(code);
    }
    setBusy(false);
  }

  async function stillStuck() {
    if (busy || level < 1 || level >= MAX_LEVEL) return;
    const code = els.code.value;

    setBusy(true);
    // If the student edited their code since the last run, hint on the new version.
    const ran = code === lastRunCode ? true : await runCode(code);
    if (ran) {
      level += 1;
      await getHint(code);
    }
    setBusy(false);
  }

  function startOver() {
    if (busy) return;
    els.code.value = "";
    updateGutter();
    level = 0;
    lastOutput = "";
    lastRunCode = null;
    resetOutput();
    clearHints();
    setStatus("");
    updateSteps();
    updateButtons();
    els.code.focus();
  }

  function loadExample() {
    if (busy) return;
    els.code.value = EXAMPLE;
    updateGutter();
    els.code.focus();
    setStatus("Example loaded. It has one bug for you to find.");
  }

  async function runCode(code) {
    setStatus("Running your code…");
    els.output.setAttribute("aria-busy", "true");

    const result = await postJson("/run", { code: code });
    els.output.removeAttribute("aria-busy");

    if (result.error) {
      setStatus("");
      showNotice(result.error);
      return false;
    }

    lastRunCode = code;
    lastOutput = (result.stdout || "") + (result.stderr || "");
    renderOutput(result);
    return true;
  }

  async function getHint(code) {
    setStatus("Thinking of a hint…");
    els.hints.setAttribute("aria-busy", "true");

    const result = await postJson("/hint", { code: code, output: lastOutput, level: level });
    els.hints.removeAttribute("aria-busy");

    if (result.error) {
      level -= 1;
      setStatus("");
      showNotice(result.error);
    } else {
      addHint(result.level || level, result.hint);
      setStatus("");
    }
    updateSteps();
  }

  /* ---------- Rendering ---------- */

  function renderOutput(result) {
    els.output.textContent = "";

    if (result.stdout) {
      els.output.appendChild(document.createTextNode(result.stdout));
    }
    if (result.stderr) {
      const err = document.createElement("span");
      err.className = "output-stderr";
      err.textContent = result.stderr;
      els.output.appendChild(err);
    }
    if (!result.stdout && !result.stderr) {
      const empty = document.createElement("span");
      empty.className = "output-empty";
      empty.textContent = "Your program finished without printing anything.";
      els.output.appendChild(empty);
    }

    if (result.timed_out) {
      setRunState("Stopped after 5 seconds", "error");
    } else if (result.returncode !== 0) {
      setRunState("Ended with an error", "error");
    } else {
      setRunState("Ran without errors", "ok");
    }
  }

  function resetOutput() {
    els.output.textContent = "";
    const empty = document.createElement("span");
    empty.className = "output-empty";
    empty.textContent = "Run your code to see what it prints.";
    els.output.appendChild(empty);
    setRunState("Not run yet", "");
  }

  function setRunState(text, state) {
    els.runState.textContent = text;
    if (state) {
      els.runState.dataset.state = state;
    } else {
      delete els.runState.dataset.state;
    }
  }

  function hintList() {
    let list = els.hints.querySelector(".hint-list");
    if (!list) {
      els.hints.textContent = "";
      list = document.createElement("ol");
      list.className = "hint-list";
      els.hints.appendChild(list);
    }
    return list;
  }

  function addHint(hintLevel, text) {
    removeNotices();

    const item = document.createElement("li");
    item.className = "hint";

    const label = document.createElement("h3");
    label.className = "hint-label";
    label.textContent = "Hint " + hintLevel + " of " + MAX_LEVEL + ": " + LEVEL_NAMES[hintLevel];

    const body = document.createElement("div");
    body.className = "hint-body";
    renderInline(body, text);

    item.appendChild(label);
    item.appendChild(body);
    hintList().appendChild(item);

    if (hintLevel >= MAX_LEVEL) {
      const note = document.createElement("p");
      note.className = "final-note";
      note.textContent = "That's the most specific hint available. Try a fix, then run your code again to start a fresh round.";
      els.hints.appendChild(note);
    }
  }

  function clearHints() {
    els.hints.textContent = "";
    const empty = document.createElement("p");
    empty.className = "hints-empty";
    empty.textContent = "Your hints will appear here. Read each one, have a go at fixing your code, and run it again.";
    els.hints.appendChild(empty);
  }

  function showNotice(message) {
    removeNotices();
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "alert");
    const strong = document.createElement("strong");
    strong.textContent = "Something went wrong. ";
    notice.appendChild(strong);
    notice.appendChild(document.createTextNode(message));

    const empty = els.hints.querySelector(".hints-empty");
    if (empty) empty.remove();
    els.hints.appendChild(notice);
  }

  function removeNotices() {
    els.hints.querySelectorAll(".notice").forEach(function (n) { n.remove(); });
  }

  // Turns the model's light markdown (`code`, **bold**, blank-line paragraphs)
  // into DOM nodes without ever using innerHTML.
  function renderInline(container, text) {
    const paragraphs = String(text).split(/\n\s*\n/);
    paragraphs.forEach(function (para) {
      const p = document.createElement("p");
      const parts = para.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
      parts.forEach(function (part) {
        if (!part) return;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          const code = document.createElement("code");
          code.textContent = part.slice(1, -1);
          p.appendChild(code);
        } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          const strong = document.createElement("strong");
          strong.textContent = part.slice(2, -2);
          p.appendChild(strong);
        } else {
          p.appendChild(document.createTextNode(part));
        }
      });
      container.appendChild(p);
    });
  }

  function updateSteps() {
    els.steps.forEach(function (li) {
      const step = Number(li.dataset.step);
      li.classList.toggle("is-done", step <= level);
      if (step === level) {
        li.setAttribute("aria-current", "step");
      } else {
        li.removeAttribute("aria-current");
      }
    });
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setBusy(value) {
    busy = value;
    updateButtons();
  }

  function updateButtons() {
    els.helpBtn.disabled = busy;
    els.resetBtn.disabled = busy;
    els.exampleBtn.disabled = busy;
    els.stuckBtn.disabled = busy || level < 1 || level >= MAX_LEVEL;
  }

  /* ---------- Editor gutter ---------- */

  function updateGutter() {
    const lines = els.code.value.split("\n").length;
    let numbers = "";
    for (let i = 1; i <= lines; i++) {
      numbers += i + (i < lines ? "\n" : "");
    }
    els.gutter.textContent = numbers;
    els.gutter.scrollTop = els.code.scrollTop;
  }

  /* ---------- Editor keys ---------- */

  const INDENT = 4;
  const DEDENT_AFTER = /^\s*(return|pass|break|continue|raise)\b/;
  let tabLeavesEditor = false;

  // execCommand keeps the browser's undo history (Ctrl+Z); fall back if it's unavailable.
  function insertText(text) {
    if (text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text)) return;
    els.code.setRangeText(text, els.code.selectionStart, els.code.selectionEnd, "end");
    els.code.dispatchEvent(new Event("input"));
  }

  function lineStartOf(pos) {
    return els.code.value.lastIndexOf("\n", pos - 1) + 1;
  }

  function cursorColumn() {
    return els.code.selectionStart - lineStartOf(els.code.selectionStart);
  }

  function selectionSpansLines() {
    const { selectionStart: s, selectionEnd: e, value } = els.code;
    return value.slice(s, e).includes("\n");
  }

  function newLineWithIndent() {
    const pos = els.code.selectionStart;
    const before = els.code.value.slice(lineStartOf(pos), pos);
    let indent = before.match(/^[ \t]*/)[0];
    const code = before.replace(/#.*$/, "").trimEnd();

    if (code.endsWith(":")) {
      indent += " ".repeat(INDENT);
    } else if (DEDENT_AFTER.test(before)) {
      indent = indent.slice(0, Math.max(0, indent.length - INDENT));
    }
    insertText("\n" + indent);
  }

  // Applies fn to every line touched by the selection, keeping the selection on those lines.
  function changeLines(fn) {
    const { selectionStart: s, selectionEnd: e, value } = els.code;
    const start = lineStartOf(s);
    // A selection ending at the very start of a line doesn't include that line.
    const last = e > s && value[e - 1] === "\n" ? e - 1 : e;
    let end = value.indexOf("\n", last);
    if (end === -1) end = value.length;

    const lines = value.slice(start, end).split("\n");
    const changed = lines.map(fn);
    const result = changed.join("\n");
    if (result === value.slice(start, end)) return;

    els.code.setSelectionRange(start, end);
    insertText(result);
    const firstShift = changed[0].length - lines[0].length;
    els.code.setSelectionRange(Math.max(start, s + firstShift), e + result.length - (end - start));
  }

  function indentLines() {
    changeLines(function (line) {
      return line ? " ".repeat(INDENT) + line : line;
    });
  }

  function outdentLines() {
    changeLines(function (line) {
      if (line.startsWith("\t")) return line.slice(1);
      return line.replace(new RegExp("^ {1," + INDENT + "}"), "");
    });
  }

  // Backspace inside leading spaces removes back to the previous indent level.
  function deleteIndentLevel() {
    const { selectionStart: s, selectionEnd: e } = els.code;
    if (s !== e) return false;
    const leading = els.code.value.slice(lineStartOf(s), s);
    if (!leading || /[^ ]/.test(leading)) return false;

    const remove = leading.length % INDENT || INDENT;
    els.code.setSelectionRange(s - remove, s);
    insertText("");
    return true;
  }

  /* ---------- Theme ---------- */

  const themeToggle = document.getElementById("themeToggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function updateThemeToggle() {
    const dark = currentTheme() === "dark";
    themeToggle.setAttribute("aria-pressed", String(dark));
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute("content", dark ? "#161513" : "#1f4e45");
    });
  }

  themeToggle.addEventListener("click", function () {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (err) {
      // Storage can be blocked; the toggle still works for this visit.
    }
    updateThemeToggle();
  });

  systemDark.addEventListener("change", updateThemeToggle);
  updateThemeToggle();

  /* ---------- Wiring ---------- */

  els.helpBtn.addEventListener("click", helpMe);
  els.stuckBtn.addEventListener("click", stillStuck);
  els.resetBtn.addEventListener("click", startOver);
  els.exampleBtn.addEventListener("click", loadExample);

  els.code.addEventListener("input", updateGutter);
  els.code.addEventListener("scroll", function () {
    els.gutter.scrollTop = els.code.scrollTop;
  });
  els.code.addEventListener("keydown", function (event) {
    if (event.isComposing) return;

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      helpMe();
      return;
    }

    // Esc, then Tab, leaves the editor, so keyboard users are never trapped in it.
    if (event.key === "Escape") {
      tabLeavesEditor = true;
      return;
    }
    if (event.key === "Tab" && tabLeavesEditor) {
      tabLeavesEditor = false;
      return;
    }
    tabLeavesEditor = false;

    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      newLineWithIndent();
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        outdentLines();
      } else if (selectionSpansLines()) {
        indentLines();
      } else {
        insertText(" ".repeat(INDENT - (cursorColumn() % INDENT)));
      }
    } else if (event.key === "Backspace" && deleteIndentLevel()) {
      event.preventDefault();
    }
  });
  els.code.addEventListener("blur", function () {
    tabLeavesEditor = false;
  });

  updateGutter();
  updateButtons();
})();

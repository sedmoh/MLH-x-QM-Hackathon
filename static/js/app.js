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

  /* ---------- Theme ---------- */

  const themeToggle = document.getElementById("themeToggle");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function updateThemeToggle() {
    themeToggle.setAttribute("aria-pressed", String(currentTheme() === "dark"));
  }

  themeToggle.addEventListener("click", function () {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (err) {
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
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      helpMe();
    }
  });

  updateGutter();
  updateButtons();
})();

(function () {
  "use strict";

  const MAX_LEVEL = 3;
  const LEVEL_NAMES = { 1: "Nudge", 2: "Location", 3: "Concept" };
  // What to do after each hint, shown under it.
  const NEXT_STEP = {
    1: "Try a change, then run again. Still stuck? Hint 2 points to where the problem is.",
    2: "Look closely at that spot, then run again. Still stuck? Hint 3 explains the idea behind it.",
    3: "That's the most specific hint there is. Try a fix, then run your code again.",
  };

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
    editor: document.getElementById("editor"),
    gutter: document.getElementById("gutter"),
    helpBtn: document.getElementById("helpBtn"),
    stuckBtn: document.getElementById("stuckBtn"),
    resetBtn: document.getElementById("resetBtn"),
    exampleBtn: document.getElementById("exampleBtn"),
    status: document.getElementById("status"),
    output: document.getElementById("output"),
    runState: document.getElementById("runState"),
    errorSummary: document.getElementById("errorSummary"),
    errorTitle: document.getElementById("errorTitle"),
    errorMessage: document.getElementById("errorMessage"),
    tracebackBox: document.getElementById("tracebackBox"),
    traceback: document.getElementById("traceback"),
    lineHighlight: document.getElementById("lineHighlight"),
    hints: document.getElementById("hints"),
    hintsPanel: document.getElementById("panel-hints"),
    steps: document.querySelectorAll(".steps li"),
    screenshot: document.getElementById("screenshot"),
    attachment: document.getElementById("attachment"),
    attachmentName: document.getElementById("attachmentName"),
    extractBtn: document.getElementById("extractBtn"),
    removeShotBtn: document.getElementById("removeShotBtn"),
    extractMsg: document.getElementById("extractMsg"),
    preview: document.getElementById("preview"),
    overlay: document.getElementById("overlay"),
    overlayImg: document.getElementById("overlayImg"),
    workspace: document.getElementById("workspace"),
    tabs: document.querySelectorAll("#tabs [role=tab]"),
    outputDot: document.getElementById("outputDot"),
    hintCount: document.getElementById("hintCount"),
    modKey: document.getElementById("modKey"),
  };

  const COPIED_MESSAGE = "Code copied from your screenshot. Check it over, then run it to get a hint.";
  const MIN_EDITOR_LINES = 12;
  const MAX_EDITOR_LINES = 24;

  // Below this width the workspace becomes tabs (matches the CSS breakpoint).
  const compact = window.matchMedia("(max-width: 61.99rem)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let level = 0;
  let lastOutput = "";
  let lastRunCode = null;
  let busy = false;
  // Hints already shown, so the tutor can make each new one add something.
  let previousHints = [];
  // The uploaded screenshot ({uri, mime_type}), or null if there isn't one.
  let screenshot = null;
  // Line of main.py the last run's error points at, or null.
  let errorLine = null;
  let editorLines = 0;

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

  // Upload the chosen screenshot. Returns {uri, mime_type}, or an {error} message.
  async function uploadScreenshot(file) {
    if (file.size > 10 * 1024 * 1024) {
      return { error: "Your screenshot is bigger than 10 MB." };
    }
    const form = new FormData();
    form.append("screenshot", file);
    try {
      const res = await fetch("/upload", { method: "POST", body: form });
      return await res.json();
    } catch (err) {
      return { error: "Could not upload your screenshot." };
    }
  }

  // "Run and get a hint": upload the screenshot (if any), run the code, then get hint 1.
  // If the code box is empty, first try to copy the code out of the screenshot.
  async function helpMe() {
    if (busy) return;
    const file = els.screenshot.files[0];
    if (!els.code.value.trim() && !file) {
      setStatus("Paste some Python code first, or add a screenshot.");
      selectTab("code");
      els.code.focus();
      return;
    }

    setBusy(true);
    clearHints();
    level = 0;
    previousHints = [];
    updateSteps();

    screenshot = null;
    let uploadError = null;
    if (file) {
      setStatus("Uploading your screenshot…");
      const uploaded = await uploadScreenshot(file);
      if (uploaded.error) {
        uploadError = uploaded.error;
      } else {
        screenshot = uploaded;
      }
    }

    // Empty box + screenshot: fill the box from the screenshot. Never overwrite code that's there.
    if (screenshot && !els.code.value.trim()) {
      setStatus("Reading code from your screenshot…");
      const extracted = await extractFrom(screenshot);
      if (extracted.code) {
        els.code.value = extracted.code;
        updateGutter();
        showExtractMsg(COPIED_MESSAGE);
      } else {
        showExtractMsg("No code could be extracted from your screenshot, so hints will use the screenshot only.");
      }
    }

    const code = els.code.value;
    let ran = false;
    if (code.trim()) {
      ran = await runCode(code);
    } else if (screenshot) {
      // Nothing to run, but Gemma can still give hints from the screenshot.
      lastOutput = "";
      lastRunCode = code;
      resetOutput();
      ran = true;
    }

    if (ran) {
      level = 1;
      await getHint(code);
    }
    if (uploadError) {
      showNotice(uploadError + " Hints use your code only.");
    } else if (!ran && !code.trim()) {
      showNotice("Please paste some Python code first.");
    }
    setBusy(false);
  }

  async function stillStuck() {
    if (busy || level < 1 || level >= MAX_LEVEL) return;
    const code = els.code.value;
    // Checked now: disabling the button below takes focus off it.
    const hadFocus = document.activeElement === els.stuckBtn;

    setBusy(true);
    // If the student edited their code since the last run, hint on the new version.
    const ran = code === lastRunCode ? true : await runCode(code);
    if (ran) {
      level += 1;
      await getHint(code);
    }
    setBusy(false);
    // Put keyboard focus back, or on Run again once the last hint hides this button.
    if (hadFocus) {
      (els.stuckBtn.hidden ? els.helpBtn : els.stuckBtn).focus();
    }
  }

  function startOver() {
    if (busy) return;
    if (els.code.value.trim() && !window.confirm("Clear your code, output and hints?")) return;
    els.code.value = "";
    updateGutter();
    level = 0;
    lastOutput = "";
    lastRunCode = null;
    previousHints = [];
    clearScreenshot();
    resetOutput();
    clearHints();
    setStatus("");
    updateSteps();
    updateButtons();
    selectTab("code");
    els.code.focus();
  }

  function loadExample() {
    if (busy) return;
    if (els.code.value.trim() && els.code.value !== EXAMPLE &&
        !window.confirm("Replace your code with the example?")) return;
    els.code.value = EXAMPLE;
    errorLine = null;
    updateGutter();
    codeChanged();
    selectTab("code");
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
    showPending(level);
    selectTab("hints");
    revealHints();

    const result = await postJson("/hint", {
      code: code,
      output: lastOutput,
      level: level,
      previous_hints: previousHints,
      screenshot: screenshot,
    });
    els.hints.removeAttribute("aria-busy");
    removePending();

    if (result.error) {
      level -= 1;
      setStatus("");
      showNotice(result.error);
    } else {
      addHint(result.level || level, result.hint);
      previousHints.push(result.hint);
      setStatus("");
      if (result.image_error) {
        showNotice(result.image_error);
        screenshot = null; // don't keep trying the screenshot for the next hints
      }
    }
    updateSteps();
    updateHintCount();
    revealHints();
  }

  /* ---------- Screenshot ---------- */

  // Ask Gemma to copy the code out of an already uploaded screenshot.
  // Returns {code}, {no_code: true}, or {error}.
  function extractFrom(uploaded) {
    return postJson("/extract", { screenshot: uploaded });
  }

  // "Copy code from screenshot": upload, copy the code out, fill the box.
  async function extractCode() {
    const file = els.screenshot.files[0];
    if (busy || !file) return;
    if (els.code.value.trim() && !window.confirm("Replace the code in the box with the code from your screenshot?")) return;
    setBusy(true);
    els.extractMsg.textContent = "";
    setStatus("Reading code from your screenshot…");

    let result = await uploadScreenshot(file);
    if (!result.error) {
      result = await extractFrom(result);
    }

    if (result.error) {
      showExtractMsg(result.error + " Your code box was not changed.");
    } else if (result.no_code) {
      showExtractMsg("No code was found in that screenshot. Please paste your code into the box instead.");
    } else {
      els.code.value = result.code;
      errorLine = null;
      updateGutter();
      showExtractMsg(COPIED_MESSAGE);
      codeChanged(); // new code, so old hints no longer apply
    }
    setStatus("");
    setBusy(false);
  }

  function showExtractMsg(text) {
    els.extractMsg.textContent = "";
    const note = document.createElement("p");
    note.className = "info-note";
    note.textContent = text;
    els.extractMsg.appendChild(note);
  }

  // A new screenshot was picked (or removed): show it and start the hints over.
  function screenshotChosen() {
    const file = els.screenshot.files[0];
    els.extractMsg.textContent = "";
    if (els.preview.src) URL.revokeObjectURL(els.preview.src);
    if (file) {
      els.preview.src = URL.createObjectURL(file);
      els.attachmentName.textContent = file.name || "Pasted screenshot";
      els.attachment.hidden = false;
    } else {
      els.preview.removeAttribute("src");
      els.attachment.hidden = true;
    }
    codeChanged();
    updateButtons();
  }

  function clearScreenshot() {
    els.screenshot.value = "";
    screenshotChosen();
  }

  // Use a dropped or pasted image as the screenshot.
  function attachFile(file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      showExtractMsg("Screenshots need to be PNG or JPG images.");
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    els.screenshot.files = transfer.files;
    screenshotChosen();
  }

  function draggingFiles(event) {
    return event.dataTransfer && Array.prototype.includes.call(event.dataTransfer.types, "Files");
  }

  // Clicking the preview shows the screenshot full size. Clicking again or Escape closes it.
  function openOverlay() {
    els.overlayImg.src = els.preview.src;
    els.overlay.hidden = false;
  }

  function closeOverlay() {
    els.overlay.hidden = true;
  }

  // When the student edits their code, the old hints no longer apply, so start over.
  function codeChanged() {
    if (busy || level === 0) return;
    level = 0;
    previousHints = [];
    clearHints();
    updateSteps();
    updateButtons();
    updateHintCount();
  }

  /* ---------- Tabs (phones and tablets) ---------- */

  function selectTab(name, focusTab) {
    els.workspace.dataset.tab = name;
    els.tabs.forEach(function (tab) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) tab.focus();
    });
  }

  // Tab panel roles only make sense while the tabs are showing.
  function updateTabRoles() {
    els.tabs.forEach(function (tab) {
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (compact.matches) {
        panel.setAttribute("role", "tabpanel");
      } else {
        panel.removeAttribute("role");
      }
    });
  }

  // Bring the hints into view when a new one arrives, unless they're already showing.
  function revealHints() {
    const rect = els.hintsPanel.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.6) return;
    els.hintsPanel.scrollIntoView({
      block: compact.matches ? "nearest" : "start",
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  }

  /* ---------- Rendering ---------- */

  // Pull "NameError", its message and the main.py line number out of a traceback.
  // Returns null when stderr doesn't look like a Python traceback.
  function parseError(stderr) {
    if (!/^Traceback |^\s*File "/m.test(stderr)) return null;
    const lines = stderr.trimEnd().split("\n");
    const last = lines[lines.length - 1];
    const match = /^([A-Za-z_][\w.]*)(?::\s*(.*))?$/.exec(last);
    if (!match) return null;

    let line = null;
    const frame = /File "main\.py", line (\d+)/g;
    let found;
    while ((found = frame.exec(stderr)) !== null) {
      line = Number(found[1]);
    }
    return { type: match[1], message: match[2] || "", line: line };
  }

  function renderSummary(error) {
    els.errorTitle.textContent = error.type;
    if (error.line) {
      els.errorTitle.appendChild(document.createTextNode(" on "));
      const jump = document.createElement("button");
      jump.type = "button";
      jump.textContent = "line " + error.line;
      jump.addEventListener("click", function () { goToLine(error.line); });
      els.errorTitle.appendChild(jump);
    }
    els.errorMessage.textContent = error.message;
    els.errorMessage.hidden = !error.message;
    els.errorSummary.hidden = false;
  }

  function hideSummary() {
    els.errorSummary.hidden = true;
    els.tracebackBox.hidden = true;
    els.tracebackBox.open = false;
    els.output.hidden = false;
    setErrorLine(null);
  }

  function renderOutput(result) {
    els.output.textContent = "";
    hideSummary();

    if (result.stdout) {
      els.output.appendChild(document.createTextNode(result.stdout));
    }
    const error = result.stderr && !result.timed_out ? parseError(result.stderr) : null;
    if (error) {
      // The summary says what went wrong; the full traceback is one click away.
      renderSummary(error);
      const body = result.stderr.trimEnd();
      const cut = body.lastIndexOf("\n") + 1;
      els.traceback.textContent = body.slice(0, cut);
      const lastLine = document.createElement("span");
      lastLine.className = "output-error-line";
      lastLine.textContent = body.slice(cut);
      els.traceback.appendChild(lastLine);
      els.tracebackBox.hidden = false;
      // Only keep the output box if the program printed something before failing.
      els.output.hidden = !result.stdout;
      setErrorLine(error.line);
    } else if (result.stderr) {
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
    hideSummary();
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
    els.outputDot.hidden = state !== "error";
  }

  function hintList() {
    let list = els.hints.querySelector(".hint-list");
    if (!list) {
      els.hints.querySelectorAll(".hints-empty").forEach(function (n) { n.remove(); });
      list = document.createElement("ol");
      list.className = "hint-list";
      els.hints.prepend(list);
    }
    return list;
  }

  function hintLabel(hintLevel) {
    const label = document.createElement("h3");
    label.className = "hint-label";
    label.textContent = "Hint " + hintLevel + " of " + MAX_LEVEL + " · " + LEVEL_NAMES[hintLevel];
    return label;
  }

  // Newest hint goes first and gets the big treatment; earlier ones step back below it.
  function addHint(hintLevel, text) {
    removeNotices();
    const list = hintList();
    list.querySelectorAll(".hint").forEach(function (h) { h.classList.add("is-past"); });

    const item = document.createElement("li");
    item.className = "hint";

    const body = document.createElement("div");
    body.className = "hint-body";
    renderInline(body, text);

    const next = document.createElement("p");
    next.className = "hint-next";
    next.textContent = NEXT_STEP[hintLevel] || "";

    item.appendChild(hintLabel(hintLevel));
    item.appendChild(body);
    item.appendChild(next);
    list.prepend(item);
  }

  // Placeholder while Gemma writes the hint, so the panel doesn't sit still.
  function showPending(hintLevel) {
    removePending();
    const pending = document.createElement("div");
    pending.className = "hint-pending";
    pending.id = "hintPending";
    pending.setAttribute("aria-hidden", "true");
    pending.appendChild(hintLabel(hintLevel));
    for (let i = 0; i < 2; i++) {
      const bar = document.createElement("div");
      bar.className = "skeleton";
      pending.appendChild(bar);
    }
    els.hints.querySelectorAll(".hints-empty").forEach(function (n) { n.remove(); });
    els.hints.prepend(pending);
  }

  function removePending() {
    const pending = document.getElementById("hintPending");
    if (pending) pending.remove();
  }

  function clearHints() {
    els.hints.textContent = "";
    const empty = document.createElement("div");
    empty.className = "hints-empty";
    const lead = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "Your first hint appears here.";
    lead.appendChild(strong);
    const more = document.createElement("p");
    more.textContent = "It starts as a gentle nudge. Each time you're still stuck, the next one gets more specific, but you always make the fix yourself.";
    empty.appendChild(lead);
    empty.appendChild(more);
    els.hints.appendChild(empty);
  }

  function updateHintCount() {
    const count = previousHints.length;
    els.hintCount.textContent = String(count);
    els.hintCount.hidden = count === 0;
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

    els.hints.querySelectorAll(".hints-empty").forEach(function (n) { n.remove(); });
    els.hints.appendChild(notice);
    selectTab("hints");
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

  // Labels follow the flow: run → (still stuck? next hint) → run again.
  // The hint button only shows while there's a next hint to ask for.
  function updateButtons() {
    els.helpBtn.disabled = busy;
    els.helpBtn.textContent = lastRunCode === null ? "Run and get a hint" : "Run again";
    els.resetBtn.disabled = busy;
    els.exampleBtn.disabled = busy;
    els.stuckBtn.hidden = level < 1 || level >= MAX_LEVEL;
    els.stuckBtn.disabled = busy;
    els.stuckBtn.textContent = compact.matches
      ? "Show hint " + (level + 1)
      : "Still stuck? Show hint " + (level + 1);
    els.extractBtn.disabled = busy || els.screenshot.files.length === 0;
    els.removeShotBtn.disabled = busy;
  }

  /* ---------- Editor gutter ---------- */

  function updateGutter() {
    const lines = els.code.value.split("\n").length;
    els.gutter.textContent = "";
    for (let i = 1; i <= lines; i++) {
      const num = document.createElement("span");
      num.textContent = String(i);
      if (i === errorLine) num.className = "is-error";
      els.gutter.appendChild(num);
      if (i < lines) els.gutter.appendChild(document.createTextNode("\n"));
    }

    // Grow the editor with the code, between 12 and 24 lines. Only when the
    // line count changes, so a size the student dragged to isn't fought on every key.
    if (lines !== editorLines) {
      editorLines = lines;
      const shown = Math.min(Math.max(lines, MIN_EDITOR_LINES), MAX_EDITOR_LINES);
      els.code.style.height = (shown * 1.5 + 1.5) + "rem";
    }

    els.gutter.scrollTop = els.code.scrollTop;
    positionHighlight();
  }

  function setErrorLine(line) {
    errorLine = line;
    updateGutter();
  }

  function positionHighlight() {
    const lines = els.code.value.split("\n").length;
    if (!errorLine || errorLine > lines) {
      els.lineHighlight.hidden = true;
      return;
    }
    const style = getComputedStyle(els.code);
    const lineHeight = parseFloat(style.lineHeight);
    const top = parseFloat(style.paddingTop) + (errorLine - 1) * lineHeight - els.code.scrollTop;
    els.lineHighlight.style.top = top + "px";
    els.lineHighlight.hidden = false;
  }

  // Select the line in the editor and scroll it into view.
  function goToLine(line) {
    const lines = els.code.value.split("\n");
    if (line > lines.length) return;
    selectTab("code");
    let start = 0;
    for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
    els.code.focus();
    els.code.setSelectionRange(start, start + lines[line - 1].length);
    const lineHeight = parseFloat(getComputedStyle(els.code).lineHeight);
    els.code.scrollTop = Math.max(0, (line - 1) * lineHeight - els.code.clientHeight / 3);
    els.gutter.scrollTop = els.code.scrollTop;
    positionHighlight();
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

  const themeButtons = document.querySelectorAll("[data-theme-choice]");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function themeChoice() {
    return document.documentElement.dataset.theme || "system";
  }

  function updateThemeSwitch() {
    const choice = themeChoice();
    themeButtons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
    });
    const dark = choice === "dark" || (choice === "system" && systemDark.matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute("content", dark ? "#161513" : "#1f4e45");
    });
  }

  themeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const choice = button.dataset.themeChoice;
      try {
        if (choice === "system") {
          delete document.documentElement.dataset.theme;
          localStorage.removeItem("theme");
        } else {
          document.documentElement.dataset.theme = choice;
          localStorage.setItem("theme", choice);
        }
      } catch (err) {
        // Storage can be blocked; the choice still applies for this visit.
      }
      updateThemeSwitch();
    });
  });

  systemDark.addEventListener("change", updateThemeSwitch);
  updateThemeSwitch();

  /* ---------- Wiring ---------- */

  // Show ⌘ on Macs, where Cmd + Enter is the natural shortcut.
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
    els.modKey.textContent = "⌘";
    els.modKey.setAttribute("title", "Command");
  }

  els.helpBtn.addEventListener("click", helpMe);
  els.stuckBtn.addEventListener("click", stillStuck);
  els.resetBtn.addEventListener("click", startOver);
  els.exampleBtn.addEventListener("click", loadExample);

  els.tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () { selectTab(tab.dataset.tab); });
    // Arrow keys move between tabs, as screen reader users expect.
    tab.addEventListener("keydown", function (event) {
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % els.tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + els.tabs.length) % els.tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = els.tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectTab(els.tabs[next].dataset.tab, true);
    });
  });
  compact.addEventListener("change", function () {
    updateTabRoles();
    updateButtons();
  });

  els.code.addEventListener("input", function () {
    // Edits can move lines around, so the old error marker may point at the wrong line.
    errorLine = null;
    updateGutter();
    codeChanged();
  });
  els.screenshot.addEventListener("change", screenshotChosen);
  els.extractBtn.addEventListener("click", extractCode);
  els.removeShotBtn.addEventListener("click", clearScreenshot);
  els.preview.addEventListener("click", openOverlay);
  els.preview.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOverlay();
    }
  });
  els.overlay.addEventListener("click", closeOverlay);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeOverlay();
  });

  // Drop a screenshot onto the editor, or paste one into it.
  els.editor.addEventListener("dragover", function (event) {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    els.editor.classList.add("is-dragging");
  });
  els.editor.addEventListener("dragleave", function (event) {
    if (!els.editor.contains(event.relatedTarget)) els.editor.classList.remove("is-dragging");
  });
  els.editor.addEventListener("drop", function (event) {
    els.editor.classList.remove("is-dragging");
    if (!draggingFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer.files[0]) attachFile(event.dataTransfer.files[0]);
  });
  els.code.addEventListener("paste", function (event) {
    const file = event.clipboardData && event.clipboardData.files[0];
    if (!file) return;
    event.preventDefault();
    attachFile(file);
  });

  els.code.addEventListener("scroll", function () {
    els.gutter.scrollTop = els.code.scrollTop;
    positionHighlight();
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

  clearHints();
  updateGutter();
  updateButtons();
  updateTabRoles();
})();

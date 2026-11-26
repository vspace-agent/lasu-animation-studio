// Independent sprite-sheet previews, per-sheet editing, and selected cloud exports.
"use strict";

const batchInput = document.querySelector("#batch-sheets");
const batchContainer = document.querySelector("#batch-previews");
const batchStatus = document.querySelector("#batch-status");
const batchCount = document.querySelector("#batch-count");
const batchSaveButton = document.querySelector("#batch-save");
let batchItems = [];
let batchSaving = false;
let batchGeneration = 0;

function batchMessage(message) {
  batchStatus.textContent = message;
}

function batchUpdateSelection() {
  const selected = batchItems.filter((item) => item.selected);
  batchCount.textContent = `${selected.length} of ${batchItems.length} animations selected`;
  batchSaveButton.disabled = batchSaving || batchSubmissionBlocked() || selected.length === 0;
  for (const item of batchItems) {
    item.card.classList.toggle("batch-selected", item.selected);
  }
}

function batchDraw(item) {
  const ctx = item.canvas.getContext("2d");
  ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
  const included = item.frames.filter((frame) => !frame.excluded);
  if (!included.length) {
    item.counter.textContent = "All frames excluded";
    return;
  }
  item.index %= included.length;
  const frame = included[item.index].canvas;
  const scale = Math.min(item.canvas.width / frame.width,
                         item.canvas.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  ctx.drawImage(frame, (item.canvas.width - width) / 2,
                (item.canvas.height - height) / 2, width, height);
  item.counter.textContent = `Frame ${item.index + 1} / ${included.length}`;
}

function batchCard(item) {
  const card = document.createElement("article");
  card.className = "batch-card batch-selected";
  item.card = card;

  const header = document.createElement("div");
  header.className = "batch-card-header";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.id = `batch-select-${item.number}`;
  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = `${item.number}. ${item.file.name}`;
  checkbox.addEventListener("change", () => {
    item.selected = checkbox.checked;
    batchUpdateSelection();
  });
  item.checkbox = checkbox;
  header.append(checkbox, label);

  const preview = document.createElement("canvas");
  preview.className = "batch-canvas";
  preview.width = 256;
  preview.height = 256;
  preview.setAttribute("aria-label", `Animation preview for ${item.file.name}`);
  item.canvas = preview;

  const controls = document.createElement("div");
  controls.className = "preview-controls";
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Pause";
  const counter = document.createElement("span");
  item.counter = counter;
  play.addEventListener("click", () => {
    item.playing = !item.playing;
    play.textContent = item.playing ? "Pause" : "Play";
    item.lastTime = 0;
  });
  controls.append(play, counter);

  const timing = document.createElement("label");
  timing.className = "timing-control";
  const timingText = document.createElement("span");
  timingText.textContent = "Frame duration";
  const timingValue = document.createElement("output");
  timingValue.textContent = "150 ms";
  timing.append(timingText, timingValue);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "50";
  slider.max = "2000";
  slider.step = "25";
  slider.value = "150";
  slider.addEventListener("input", () => {
    item.duration = Number(slider.value);
    timingValue.textContent = `${item.duration} ms`;
    item.lastTime = 0;
  });

  const editToggle = document.createElement("button");
  editToggle.type = "button";
  editToggle.className = "batch-edit-toggle";
  editToggle.textContent = "Edit frames";
  editToggle.setAttribute("aria-expanded", "false");
  const grid = document.createElement("div");
  grid.className = "frame-grid";
  grid.hidden = true;
  editToggle.addEventListener("click", () => {
    grid.hidden = !grid.hidden;
    editToggle.setAttribute("aria-expanded", String(!grid.hidden));
    editToggle.textContent = grid.hidden ? "Edit frames" : "Hide frame editor";
  });

  for (const frame of item.frames) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `Frame ${frame.number} included`);
    const thumb = document.createElement("canvas");
    thumb.width = frame.canvas.width;
    thumb.height = frame.canvas.height;
    thumb.getContext("2d").drawImage(frame.canvas, 0, 0);
    const number = document.createElement("small");
    number.textContent = String(frame.number);
    button.append(thumb, number);
    button.addEventListener("click", () => {
      const includedCount = item.frames.filter((f) => !f.excluded).length;
      if (!frame.excluded && includedCount === 1) {
        batchMessage("Keep at least one frame in each animation.");
        return;
      }
      frame.excluded = !frame.excluded;
      button.classList.toggle("excluded", frame.excluded);
      button.setAttribute("aria-pressed", String(frame.excluded));
      button.setAttribute("aria-label",
        `Frame ${frame.number} ${frame.excluded ? "excluded" : "included"}`);
      item.index = 0;
      item.lastTime = 0;
      batchDraw(item);
    });
    grid.appendChild(button);
  }

  card.append(header, preview, controls, timing, slider, editToggle, grid);
  batchDraw(item);
  return card;
}

function batchTick(timestamp) {
  for (const item of batchItems) {
    if (!item.playing) continue;
    if (!item.lastTime) item.lastTime = timestamp;
    if (timestamp - item.lastTime >= item.duration) {
      item.index++;
      item.lastTime = timestamp;
      batchDraw(item);
    }
  }
  requestAnimationFrame(batchTick);
}
requestAnimationFrame(batchTick);

batchInput.addEventListener("change", async () => {
  const files = Array.from(batchInput.files || []);
  if (!files.length) return;
  if (files.length > 15) {
    batchMessage("Choose no more than 15 sprite sheets.");
    batchInput.value = "";
    return;
  }
  if (files.some((file) => !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024)) {
    batchMessage("Each sheet must be PNG or JPEG and no larger than 5 MB.");
    batchInput.value = "";
    return;
  }
  const generation = ++batchGeneration;
  batchSaveButton.disabled = true;
  batchMessage(`Preparing ${files.length} independent previews…`);
  try {
    const images = await Promise.all(files.map(loadImage));
    if (generation !== batchGeneration) return;
    if (images.some((image) => image.naturalWidth < 4 ||
        image.naturalHeight < 4 ||
        image.naturalWidth * image.naturalHeight > 4_000_000) ||
        images.reduce((sum, image) =>
          sum + image.naturalWidth * image.naturalHeight, 0) > 60_000_000) {
      throw new Error("Image dimensions exceed the supported batch limits.");
    }
    const items = images.map((image, index) => ({
      number: index + 1,
      file: files[index],
      frames: sliceImage(image, 1),
      selected: true,
      playing: true,
      index: 0,
      duration: 150,
      lastTime: 0
    }));
    const cards = items.map(batchCard);
    batchItems = items;
    batchContainer.replaceChildren(...cards);
    batchUpdateSelection();
    batchMessage(`${items.length} independent previews ready. Edit or deselect any animation.`);
  } catch (error) {
    if (generation === batchGeneration) batchMessage(error.message);
  }
});

document.querySelector("#batch-select-all").addEventListener("click", () => {
  for (const item of batchItems) {
    item.selected = true;
    item.checkbox.checked = true;
  }
  batchUpdateSelection();
});

document.querySelector("#batch-select-none").addEventListener("click", () => {
  for (const item of batchItems) {
    item.selected = false;
    item.checkbox.checked = false;
  }
  batchUpdateSelection();
});


const LASU_BACKGROUND_JOB_KEY = "lasu-background-job";
const LASU_BATCH_STATE_KEY = "lasu-sequential-batch-v1";
const BATCH_GROUP_SIZE = 5;
const batchJobsURL = API_URL.slice(0, -"/animate".length) + "/jobs";
let batchPollTimer = null;
let batchPolling = false;
let batchStorageBlocked = false;

function batchReadState() {
  const raw = localStorage.getItem(LASU_BATCH_STATE_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw);
  if (!state || !Array.isArray(state.jobs)) {
    throw new Error("Invalid stored batch record.");
  }
  return state;
}

function batchSubmissionBlocked() {
  if (batchStorageBlocked) return true;
  try {
    const state = batchReadState();
    return Boolean(state && state.stage !== "completed");
  } catch {
    return true;
  }
}

function batchPersist(state) {
  localStorage.setItem(LASU_BATCH_STATE_KEY, JSON.stringify(state));
}

function batchStartPolling() {
  if (batchPollTimer) clearInterval(batchPollTimer);
  batchPollTimer = setInterval(batchPollJobs, 5000);
  batchPollJobs();
}

async function batchPollJobs() {
  if (batchPolling || batchSaving || !deviceToken) return;
  batchPolling = true;
  try {
    const state = batchReadState();
    if (!state || state.stage === "completed" || !state.jobs.length) return;

    const jobs = await Promise.all(state.jobs.map(async entry => {
      const response = await fetch(
        `${batchJobsURL}/${encodeURIComponent(entry.id)}`,
        {
          headers: {Authorization: `Bearer ${deviceToken}`},
          cache: "no-store"
        }
      );
      if (!response.ok) {
        throw new Error(`Status unavailable (${response.status})`);
      }
      return response.json();
    }));

    const completed = jobs.reduce((n, j) => n + Number(j.completed || 0), 0);
    const results = jobs.flatMap(j => j.results || []);
    const running = results.filter(s => s === "running").length;
    const retrying = results.filter(s => s === "retrying").length;
    const failed = results.filter(s => s === "failed").length;
    const accepted = state.jobs.reduce((n, j) => n + j.count, 0);
    const terminal = jobs.every((j, i) =>
      Array.isArray(j.results) &&
      j.results.length === state.jobs[i].count &&
      j.results.every(s => s === "completed" || s === "failed")
    );

    state.completed = completed;
    state.failed = failed;

    const summary = `Cloud batch: ${completed}/${state.total} saved · ` +
      `${accepted} accepted · ${running} running · ` +
      `${retrying} retrying · ${failed} failed.`;

    if (state.stage === "inspection_required") {
      batchMessage(`${summary} ${state.error} Do not resubmit.`);
    } else if (terminal) {
      state.stage = completed === state.total && failed === 0
        ? "completed" : "inspection_required";
      if (state.stage === "completed") {
        batchMessage(`${summary} All animations are in Cloud Library.`);
      } else {
        state.error = "Incomplete cloud batch; inspect before retrying.";
        batchMessage(`${summary} ${state.error}`);
      }
    } else {
      batchMessage(`${summary} Processing continues if this browser closes.`);
    }

    batchPersist(state);

    if (terminal) {
      clearInterval(batchPollTimer);
      batchPollTimer = null;
      await refreshProjects();
    }
  } catch (error) {
    batchMessage(`Cloud batch status: ${error.message}. Will check again.`);
  } finally {
    batchPolling = false;
    batchUpdateSelection();
  }
}

try {
  let state = batchReadState();
  const legacy = localStorage.getItem(LASU_BACKGROUND_JOB_KEY);
  const recoveryRaw = localStorage.getItem("lasu-nine-sheet-recovery-v1");
  if (!state && recoveryRaw) {
    const recovery = JSON.parse(recoveryRaw);
    if (recovery.stage === "completed" &&
        recovery.completed === recovery.total &&
        recovery.failed === 0) {
      state = {
        ...recovery,
        version: 1,
        stage: "completed"
      };
      batchPersist(state);
    } else {
      batchStorageBlocked = true;
      batchMessage("An earlier recovery requires verification before submitting another batch.");
    }
  }
  if (legacy && /^[0-9a-f]{32}$/.test(legacy)) {
    batchStorageBlocked = true;
    batchMessage("Checking earlier cloud job…");
    const checkLegacy = async () => {
      if (!deviceToken) return;
      try {
        const response = await fetch(
          `${batchJobsURL}/${encodeURIComponent(legacy)}`,
          {
            headers: {Authorization: `Bearer ${deviceToken}`},
            cache: "no-store"
          }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const job = await response.json();
        if (job.status === "completed" &&
            job.completed === job.total &&
            Array.isArray(job.results) &&
            job.results.length === job.total &&
            job.results.every(s => s === "completed")) {
          localStorage.removeItem(LASU_BACKGROUND_JOB_KEY);
          if (!recoveryRaw || JSON.parse(recoveryRaw).stage === "completed") {
            batchStorageBlocked = false;
          }
          clearInterval(legacyTimer);
          batchMessage("Earlier cloud job verified complete.");
          await refreshProjects();
        } else {
          batchMessage(`Earlier cloud job: ${job.completed}/${job.total} saved. New submissions remain blocked.`);
        }
      } catch (error) {
        batchMessage(`Earlier cloud job verification: ${error.message}`);
      } finally {
        batchUpdateSelection();
      }
    };
    const legacyTimer = setInterval(checkLegacy, 5000);
    checkLegacy();
  }
  if (state && state.stage === "submitting") {
    state.stage = "inspection_required";
    state.error = "Submission interrupted; acceptance must be checked before retrying.";
    batchPersist(state);
  }
  if (state && state.stage !== "completed") {
    if (state.jobs.length) batchStartPolling();
    else batchMessage(state.error || "Unconfirmed submission; inspect before retrying.");
  }
} catch (error) {
  batchStorageBlocked = true;
  batchMessage(`Stored batch state unavailable: ${error.message}`);
}

batchSaveButton.addEventListener("click", async () => {
  if (batchSaving || batchSubmissionBlocked()) return;
  const selected = batchItems.filter(item => item.selected);
  if (!selected.length) {
    batchMessage("Select at least one animation.");
    return;
  }
  if (!deviceToken) {
    batchMessage("Pair this device before saving to GCS.");
    return;
  }
  const project = selectedProject();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project || "")) {
    batchMessage("Choose or create a destination project.");
    return;
  }

  const format = document.querySelector("#batch-format").value;
  const items = selected.map(item => ({
    file: item.file,
    settings: {
      format,
      duration_ms: item.duration,
      excluded: item.frames.filter(frame => frame.excluded).map(frame => frame.number)
    }
  }));

  const state = {
    version: 1,
    project,
    total: items.length,
    stage: "submitting",
    jobs: [],
    started: new Date().toISOString()
  };

  batchSaving = true;
  batchInput.disabled = true;
  batchUpdateSelection();

  try {
    batchPersist(state);

    for (let offset = 0; offset < items.length; offset += BATCH_GROUP_SIZE) {
      const group = items.slice(offset, offset + BATCH_GROUP_SIZE);
      const bytes = group.reduce((n, item) => n + item.file.size, 0);
      if (bytes > 25 * 1024 * 1024) {
        throw new Error("Upload group exceeds the safe request size.");
      }

      const body = new FormData();
      group.forEach(item => body.append("sheets", item.file, item.file.name));
      body.append("settings", JSON.stringify(group.map(item => item.settings)));
      body.append("project", project);

      state.pendingOffset = offset;
      batchPersist(state);

      batchMessage(
        `Uploading animations ${offset + 1}–${offset + group.length} ` +
        `of ${items.length}. Keep this tab open until all groups are accepted.`
      );

      const response = await fetch(batchJobsURL, {
        method: "POST",
        headers: {Authorization: `Bearer ${deviceToken}`},
        body
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`Submission failed (${response.status}): ${message.slice(0, 200)}`);
      }

      const job = await response.json();

      if (!/^[0-9a-f]{32}$/.test(job.id || "")) {
        throw new Error("Unconfirmed cloud job identity.");
      }

      state.jobs.push({id: job.id, count: group.length, offset});
      delete state.pendingOffset;
      batchPersist(state);

      if (job.total !== group.length ||
          job.queued !== group.length ||
          job.status !== "queued") {
        throw new Error("Cloud job only partially accepted.");
      }
    }

    state.stage = "accepted";
    batchPersist(state);
    localStorage.setItem(LAST_PROJECT_KEY, project);

    batchMessage(
      `${items.length} animations queued in ${state.jobs.length} cloud jobs. ` +
      "You may now close this tab or let your Mac sleep."
    );
  } catch (error) {
    state.stage = "inspection_required";
    state.error = error.message;
    try {
      batchPersist(state);
    } catch {
      batchStorageBlocked = true;
    }
    batchMessage(`Submission paused: ${error.message}. Do not resubmit.`);
  } finally {
    batchSaving = false;
    batchInput.disabled = false;
    batchUpdateSelection();
    if (state.jobs.length) batchStartPolling();
  }
});

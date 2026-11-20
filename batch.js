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
  batchSaveButton.disabled = batchSaving || selected.length === 0;
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
  if (files.length > 10) {
    batchMessage("Choose no more than 10 sprite sheets.");
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
          sum + image.naturalWidth * image.naturalHeight, 0) > 24_000_000) {
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

batchSaveButton.addEventListener("click", async () => {
  if (batchSaving) return;
  const selected = batchItems.filter((item) => item.selected);
  if (!selected.length) {
    batchMessage("Select at least one animation.");
    return;
  }
  if (!deviceToken) {
    batchMessage("Pair this device above the project selector before saving to GCS.");
    return;
  }
  const project = selectedProject();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project || "")) {
    batchMessage("Choose or create a destination project directly above Save selected → GCS.");
    return;
  }
  const format = document.querySelector("#batch-format").value;
  batchSaving = true;
  batchInput.disabled = true;
  batchSaveButton.disabled = true;
  let saved = 0;
  try {
    for (const item of selected) {
      batchMessage(`Saving ${saved + 1} of ${selected.length}: ${item.file.name}…`);
      const rules = item.frames.filter((frame) => frame.excluded)
        .map((frame) => frame.number);
      const body = new FormData();
      body.append("sheets", item.file, item.file.name);
      body.append("format", format);
      body.append("duration_ms", String(item.duration));
      body.append("cycles", "1");
      body.append("skip_rules", JSON.stringify(rules.length ? {"1": rules} : {}));
      body.append("project", project);
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {Authorization: `Bearer ${deviceToken}`},
        body
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`${item.file.name}: ${response.status} ${message.slice(0, 160)}`);
      }
      await response.blob();
      saved++;
    }
    localStorage.setItem(LAST_PROJECT_KEY, project);
    await refreshProjects();
    batchMessage(`Saved ${saved} ${format.toUpperCase()} animations to GCS in ${project}.`);
  } catch (error) {
    batchMessage(`Saved ${saved} of ${selected.length}. ${error.message}`);
  } finally {
    batchSaving = false;
    batchInput.disabled = false;
    batchUpdateSelection();
  }
});

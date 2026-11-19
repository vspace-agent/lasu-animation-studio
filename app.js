// Lasu Animation Studio: prompts, sprite selection, preview, and cloud export.

const API_URL = "https://lasu-animation-516584546026.europe-west3.run.app/animate";

const PROMPT_FILES = {
  tuki: "./Agent_Tuki_16frame_animation narrative.md",
  lasu: "./Agent_16-Frame Animation Sprite Sheet"
};

const $ = (selector) => document.querySelector(selector);

const input = $("#sheets");
const sheetList = $("#sheet-list");
const frameGrid = $("#frame-grid");
const durationInput = $("#duration");
const durationValue = $("#duration-value");
const playButton = $("#play-pause");
const counter = $("#frame-counter");
const canvas = $("#preview");
const context = canvas.getContext("2d");
const status = $("#status");

let sheets = [];
let frames = [];
let selectedFrames = [];
let playing = true;
let frameIndex = 0;
let lastFrameTime = 0;
let animationHandle = null;
let busy = false;

function setStatus(message) {
  status.textContent = message;
}

const promptCache = new Map();

async function getPrompt(name) {
  if (promptCache.has(name)) return promptCache.get(name);
  const file = PROMPT_FILES[name];
  if (!file) throw new Error("Unknown prompt");
  const response = await fetch(file);
  if (!response.ok) throw new Error(`Prompt unavailable (${response.status})`);
  const prompt = await response.text();
  promptCache.set(name, prompt);
  return prompt;
}

async function loadPromptPreviews() {
  for (const preview of document.querySelectorAll("[data-prompt-preview]")) {
    try {
      preview.textContent = await getPrompt(preview.dataset.promptPreview);
    } catch {
      preview.textContent = "Prompt preview unavailable.";
    }
  }
}

async function copyPrompt(name, button) {
  let prompt;
  try {
    prompt = await getPrompt(name);
  } catch {
    setStatus("Could not load the prompt.");
    return;
  }

  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    const field = document.createElement("textarea");
    field.value = prompt;
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    copied = document.execCommand("copy");
    field.remove();
  }

  if (!copied) {
    setStatus("Clipboard unavailable. Please try again.");
    return;
  }

  button.textContent = "✓ Copied!";
  button.classList.add("copied");
  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => {
    button.textContent = "Copy";
    button.classList.remove("copied");
  }, 2500);
  setStatus(`${name === "tuki" ? "Tuki" : "Lasu"} prompt copied.`);
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyPrompt(button.dataset.copy, button));
});

loadPromptPreviews();

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };

    image.src = url;
  });
}

function sliceImage(image, sheetNumber) {
  const result = [];

  for (let row = 0; row < 4; row++) {
    const top = Math.round(row * image.naturalHeight / 4);
    const bottom = Math.round((row + 1) * image.naturalHeight / 4);

    for (let column = 0; column < 4; column++) {
      const left = Math.round(column * image.naturalWidth / 4);
      const right = Math.round((column + 1) * image.naturalWidth / 4);

      const tile = document.createElement("canvas");
      tile.width = right - left;
      tile.height = bottom - top;

      tile.getContext("2d").drawImage(
        image, left, top, tile.width, tile.height,
        0, 0, tile.width, tile.height
      );

      result.push({
        sheet: sheetNumber,
        number: row * 4 + column + 1,
        canvas: tile,
        excluded: false
      });
    }
  }

  return result;
}

function refreshSelection() {
  selectedFrames = frames.filter((frame) => !frame.excluded);
  frameIndex = 0;
  lastFrameTime = 0;
  renderPreview();
}

function renderFrameGrid() {
  frameGrid.replaceChildren();

  for (const frame of frames) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = frame.excluded ? "excluded" : "";
    button.setAttribute(
      "aria-label",
      `Sheet ${frame.sheet}, frame ${frame.number}, ${
        frame.excluded ? "excluded" : "included"
      }`
    );
    button.setAttribute("aria-pressed", String(frame.excluded));

    const thumbnail = document.createElement("canvas");
    thumbnail.width = frame.canvas.width;
    thumbnail.height = frame.canvas.height;
    thumbnail.getContext("2d").drawImage(frame.canvas, 0, 0);

    const label = document.createElement("small");
    label.textContent = `${frame.sheet}.${frame.number}`;

    button.append(thumbnail, label);
    button.addEventListener("click", () => {
      frame.excluded = !frame.excluded;
      button.classList.toggle("excluded", frame.excluded);
      button.setAttribute("aria-pressed", String(frame.excluded));
      button.setAttribute(
        "aria-label",
        `Sheet ${frame.sheet}, frame ${frame.number}, ${
          frame.excluded ? "excluded" : "included"
        }`
      );
      refreshSelection();
    });

    frameGrid.appendChild(button);
  }
}

function renderPreview() {
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!selectedFrames.length) {
    counter.textContent = frames.length
      ? "All frames excluded"
      : "No frames loaded";
    return;
  }

  frameIndex %= selectedFrames.length;
  const frame = selectedFrames[frameIndex].canvas;

  const scale = Math.min(
    canvas.width / frame.width,
    canvas.height / frame.height
  );

  const width = frame.width * scale;
  const height = frame.height * scale;

  context.drawImage(
    frame,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height
  );

  counter.textContent =
    `Frame ${frameIndex + 1} / ${selectedFrames.length}`;
}

function animate(timestamp) {
  if (playing && selectedFrames.length) {
    const duration = Number(durationInput.value);

    if (!lastFrameTime) lastFrameTime = timestamp;

    if (timestamp - lastFrameTime >= duration) {
      frameIndex = (frameIndex + 1) % selectedFrames.length;
      lastFrameTime = timestamp;
      renderPreview();
    }
  }

  animationHandle = requestAnimationFrame(animate);
}

animationHandle = requestAnimationFrame(animate);

playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause" : "Play";
  lastFrameTime = 0;
});

durationInput.addEventListener("input", () => {
  durationValue.textContent = `${durationInput.value} ms`;
  lastFrameTime = 0;
});

input.addEventListener("change", async () => {
  const files = Array.from(input.files || []);

  if (!files.length) return;

  if (files.length > 5) {
    setStatus("Please choose no more than five sprite sheets.");
    input.value = "";
    return;
  }

  if (files.some((file) =>
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )) {
    setStatus("Each sheet must be PNG or JPEG and no larger than 5 MB.");
    input.value = "";
    return;
  }

  try {
    const loaded = await Promise.all(files.map(loadImage));
    const totalPixels = loaded.reduce(
      (sum, image) => sum + image.naturalWidth * image.naturalHeight,
      0
    );

    if (loaded.some((image) =>
      image.naturalWidth < 4 ||
      image.naturalHeight < 4 ||
      image.naturalWidth * image.naturalHeight > 4_000_000
    ) || totalPixels > 12_000_000) {
      throw new Error("Image dimensions exceed the supported limits.");
    }

    sheets = files;
    frames = loaded.flatMap((image, index) =>
      sliceImage(image, index + 1)
    );

    sheetList.textContent = files
      .map((file, index) => `${index + 1}. ${file.name}`)
      .join(" · ");

    renderFrameGrid();
    refreshSelection();
    setStatus(`${frames.length} frames loaded. Tap a frame to exclude it.`);
    await saveUploadedSheetsToCloud(files);
  } catch (error) {
    setStatus(error.message);
  }
});

function skipRules() {
  const rules = {};

  for (const frame of frames) {
    if (!frame.excluded) continue;
    const key = String(frame.sheet);
    if (!rules[key]) rules[key] = [];
    rules[key].push(frame.number);
  }

  return rules;
}

function downloadAnimation(blob, format) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lasu-animation.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}


const API_BASE = API_URL.replace(/\/animate$/, "");
const DEVICE_KEY = "lasu-device-token";
const LAST_PROJECT_KEY = "lasu-last-project";
let deviceToken = localStorage.getItem(DEVICE_KEY);

function selectedProject() {
  const selection = $("#project-select").value;
  if (selection === "__new__") {
    return $("#new-project").value.trim().toLowerCase()
      .replace(/\s+/g, "_");
  }
  return selection;
}

async function refreshProjects() {
  if (!deviceToken) {
    $("#pairing-state").textContent = "Pair this device once to enable private cloud storage.";
    $("#pairing-controls").hidden = false;
    $("#project-controls").hidden = true;
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${deviceToken}` }
    });
    if (response.status === 401) {
      deviceToken = null;
      localStorage.removeItem(DEVICE_KEY);
      await refreshProjects();
      return;
    }
    if (!response.ok) throw new Error(`Project lookup failed (${response.status}).`);
    const payload = await response.json();
    const select = $("#project-select");
    const previous = localStorage.getItem(LAST_PROJECT_KEY) || select.value;
    select.replaceChildren(new Option("Choose a project", ""));
    for (const project of payload.projects) {
      select.add(new Option(project.name, project.name));
    }
    select.add(new Option("+ New Project", "__new__"));
    if (Array.from(select.options).some((option) => option.value === previous)) {
      select.value = previous;
    }
    $("#pairing-state").textContent = "This device is paired with Mushroom House 🍄 Studio.";
    $("#pairing-controls").hidden = true;
    $("#project-controls").hidden = false;
    $("#new-project-controls").hidden = select.value !== "__new__";
  } catch (error) {
    setStatus(error.message);
  }
}

$("#pair-device").addEventListener("click", async () => {
  const code = $("#pairing-code").value.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) {
    setStatus("Enter the eight-character pairing code.");
    return;
  }
  const button = $("#pair-device");
  button.disabled = true;
  try {
    const body = new FormData();
    body.append("code", code);
    const response = await fetch(`${API_BASE}/pair`, { method: "POST", body });
    if (!response.ok) throw new Error("Pairing code invalid, expired, or already used.");
    const payload = await response.json();
    deviceToken = payload.device_token;
    localStorage.setItem(DEVICE_KEY, deviceToken);
    $("#pairing-code").value = "";
    await refreshProjects();
    setStatus("Device paired. Choose or create an animation project.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#project-select").addEventListener("change", async () => {
  const value = $("#project-select").value;
  $("#new-project-controls").hidden = value !== "__new__";
  if (value && value !== "__new__") {
    localStorage.setItem(LAST_PROJECT_KEY, value);
    if (frames.length && input.files.length) {
      await saveUploadedSheetsToCloud(Array.from(input.files));
    }
  }
});

$("#new-project").addEventListener("change", async () => {
  if (frames.length && input.files.length && selectedProject()) {
    await saveUploadedSheetsToCloud(Array.from(input.files));
  }
});

refreshProjects();

async function saveUploadedSheetsToCloud(files) {
  if (!deviceToken) return;
  const project = selectedProject();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project || "")) {
    setStatus(`${frames.length} frames loaded. Choose a project to save sheets to GCS.`);
    return;
  }

  const data = new FormData();
  for (const file of files) data.append("sheets", file, file.name);
  data.append("project", project);
  setStatus(`Saving ${files.length} sprite sheet(s) to GCS…`);

  try {
    const response = await fetch(`${API_BASE}/assets/sprites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: data
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Sprite storage failed (${response.status}): ${message.slice(0, 160)}`);
    }
    localStorage.setItem(LAST_PROJECT_KEY, project);
    await refreshProjects();
    setStatus(`${frames.length} frames loaded; sprite sheets saved to GCS in ${project}.`);
  } catch (error) {
    setStatus(`${frames.length} frames loaded locally. ${error.message}`);
  }
}

const preparedExports = new Map();

async function exportAnimation(format, action = "download") {
  if (busy) return;
  if (!sheets.length || !selectedFrames.length) {
    setStatus("Please upload sheets and keep at least one frame.");
    return;
  }
  const cloud = action === "cloud";
  const project = cloud ? selectedProject() : null;
  if (cloud) {
    if (!deviceToken) {
      setStatus("Pair this device before saving to GCS.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project || "")) {
      setStatus("Choose a project or enter a name using letters, numbers, _ or -.");
      return;
    }
  }

  const rules = JSON.stringify(skipRules());
  const signature = JSON.stringify({
    format, duration: durationInput.value, rules,
    sheets: sheets.map((file) => [
      file.name, file.size, file.lastModified, file.type
    ])
  });
  const cacheKey = `${format}:${cloud ? project : "device"}`;
  const prepared = preparedExports.get(cacheKey);
  if (!cloud && prepared && prepared.signature === signature) {
    if (cloud) {
      setStatus(`${format.toUpperCase()} already saved to GCS in ${project}.`);
    } else {
      downloadAnimation(prepared.blob, format);
      setStatus(`${format.toUpperCase()} download started.`);
    }
    return;
  }

  const data = new FormData();
  for (const sheet of sheets) data.append("sheets", sheet, sheet.name);
  data.append("format", format);
  data.append("duration_ms", durationInput.value);
  data.append("cycles", "1");
  data.append("skip_rules", rules);
  if (cloud) data.append("project", project);

  busy = true;
  document.querySelectorAll("[data-export]").forEach((button) => {
    button.disabled = true;
  });
  setStatus(cloud ? `Saving ${format.toUpperCase()} to GCS…`
                  : `Preparing ${format.toUpperCase()} download…`);
  try {
    const headers = cloud ? { Authorization: `Bearer ${deviceToken}` } : {};
    const response = await fetch(API_URL, { method: "POST", headers, body: data });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Export failed (${response.status}): ${message.slice(0, 200)}`);
    }
    const blob = await response.blob();
    preparedExports.set(cacheKey, { signature, blob });
    if (cloud) {
      localStorage.setItem(LAST_PROJECT_KEY, project);
      await refreshProjects();
      setStatus(`${format.toUpperCase()} saved to GCS in ${project}.`);
    } else {
      downloadAnimation(blob, format);
      setStatus(`${format.toUpperCase()} download started.`);
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    busy = false;
    document.querySelectorAll("[data-export]").forEach((button) => {
      button.disabled = false;
    });
  }
}

document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", () =>
    exportAnimation(button.dataset.export, button.dataset.action)
  );
});

// Lasu Animation Studio: prompts, sprite selection, preview, and cloud export.

const API_URL = "https://lasu-animation-516584546026.europe-west3.run.app/animate";

const PROMPT_FILES = {
  tuki: "./Agent_Tuki_16frame_animation narrative.md",
  lasu: "./Lasu_Reel_movie.json"
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

async function copyPrompt(name) {
  const file = PROMPT_FILES[name];
  if (!file) return;

  let prompt;
  try {
    const response = await fetch(file);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    prompt = await response.text();
  } catch (error) {
    setStatus(`Could not load ${name} prompt: ${error.message}`);
    return;
  }

  try {
    await navigator.clipboard.writeText(prompt);
    setStatus(`${name === "tuki" ? "Tuki" : "Lasu"} prompt copied.`);
  } catch {
    const field = document.createElement("textarea");
    field.value = prompt;
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    setStatus(copied ? "Prompt copied." : "Clipboard unavailable. Please try again.");
  }
}

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyPrompt(button.dataset.copy));
});

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

async function exportAnimation(format) {
  if (busy) return;

  if (!sheets.length || !selectedFrames.length) {
    setStatus("Please upload sheets and keep at least one frame.");
    return;
  }

  const cycles = Number($("#cycles").value);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10) {
    setStatus("GIF cycles must be between 1 and 10.");
    return;
  }

  const data = new FormData();

  for (const sheet of sheets) {
    data.append("sheets", sheet, sheet.name);
  }

  data.append("format", format);
  data.append("duration_ms", durationInput.value);
  data.append("cycles", String(cycles));
  data.append("skip_rules", JSON.stringify(skipRules()));

  busy = true;
  document.querySelectorAll("[data-export]").forEach((button) => {
    button.disabled = true;
  });

  setStatus(`Creating ${format.toUpperCase()}…`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: data
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Export failed (${response.status}): ${message.slice(0, 200)}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `lasu-animation.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(`${format.toUpperCase()} ready. Download started.`);
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
    exportAnimation(button.dataset.export)
  );
});

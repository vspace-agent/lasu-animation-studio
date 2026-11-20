// Browse authenticated GCS assets and share multiple selected files with the device.
"use strict";

const API = "https://lasu-animation-516584546026.europe-west3.run.app";
const token = localStorage.getItem("lasu-device-token");
const projectSelect = document.querySelector("#library-project");
const grid = document.querySelector("#library-grid");
const status = document.querySelector("#library-status");
const saveButton = document.querySelector("#save-selected");
const allButton = document.querySelector("#select-all");
const clearButton = document.querySelector("#clear-selection");
const moveDestination = document.querySelector("#move-destination");
const moveButton = document.querySelector("#move-selected");
let moving = false;

let assets = [];
let selected = new Set();
let previewUrls = [];
let assetBlobs = new Map();

function message(value) { status.textContent = value; }
function headers() { return { Authorization: `Bearer ${token}` }; }
function updateSelection() {
  saveButton.disabled = selected.size === 0 || [...selected].some(path => !assetBlobs.has(path));
  moveButton.disabled = moving || selected.size === 0 ||
    !moveDestination.value || moveDestination.value === projectSelect.value;
  moveButton.textContent = `Move Selected (${selected.size})`;

  clearButton.disabled = selected.size === 0;
  allButton.disabled = assets.length === 0 || selected.size === assets.length;
  saveButton.textContent = `Save Selected (${selected.size})`;
  for (const card of grid.querySelectorAll(".library-card")) {
    const checked = selected.has(card.dataset.path);
    card.classList.toggle("selected", checked);
    card.querySelector("input").checked = checked;
  }
}
function assetParams(asset) {
  const name = asset.path.split("/").pop();
  const match = /^([0-9a-f]{64})\.(png|jpg|gif|mp4)$/.exec(name);
  if (!match) throw new Error("Invalid stored asset name.");
  return new URLSearchParams({
    project: projectSelect.value, kind: asset.kind,
    digest: match[1], extension: match[2]
  });
}
async function fetchAsset(asset) {
  const response = await fetch(`${API}/assets/file?${assetParams(asset)}`, { headers: headers() });
  if (!response.ok) throw new Error(`File retrieval failed (${response.status}).`);
  return response.blob();
}
function resetGrid() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
  assetBlobs.clear();
  grid.replaceChildren();
  assets = [];
  selected.clear();
  updateSelection();
}
async function loadAssets() {
  resetGrid();
  const project = projectSelect.value;
  if (!project) return;
  message("Loading private library…");
  try {
    const response = await fetch(`${API}/assets?${new URLSearchParams({ project })}`, { headers: headers() });
    if (!response.ok) throw new Error(`Library lookup failed (${response.status}).`);
    const payload = await response.json();
    assets = payload.assets;
    for (const asset of assets) {
      const card = document.createElement("label");
      card.className = "library-card";
      card.dataset.path = asset.path;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", `Select ${asset.kind} ${asset.path.split("/").pop()}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(asset.path);
        else selected.delete(asset.path);
        updateSelection();
      });
      card.append(checkbox);
      const media = document.createElement(asset.kind === "mp4" ? "video" : "img");
      if (asset.kind === "mp4") {
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.controls = true;
        media.preload = "metadata";
      } else {
        media.alt = `${asset.kind} preview`;
        media.loading = "lazy";
      }
      card.append(media);
      const caption = document.createElement("span");
      caption.className = "caption";
      caption.textContent = `${asset.kind.toUpperCase()} · ${asset.path.split("/").pop().slice(0, 12)}… · ${(asset.size / 1024).toFixed(0)} KB`;
      card.append(caption);
      grid.append(card);
    }
    updateSelection();
    message(`${assets.length} file(s) in ${project}.`);
    for (const asset of assets) {
      if (projectSelect.value !== project) break;
      const card = Array.from(grid.children).find(node => node.dataset.path === asset.path);
      if (!card) continue;
      try {
        const blob = await fetchAsset(asset);
        if (projectSelect.value !== project) break;
        assetBlobs.set(asset.path, blob);
        updateSelection();
        const url = URL.createObjectURL(blob);
        previewUrls.push(url);
        card.querySelector("img,video").src = url;
      } catch (_) {
        card.querySelector(".caption").textContent += " · Preview unavailable";
      }
    }
  } catch (error) { message(error.message); }
}
async function initialize() {
  if (!token) {
    document.querySelector("#library-auth").textContent =
      "Pair this device in Animation Studio before opening the private library.";
    return;
  }
  try {
    const response = await fetch(`${API}/projects`, { headers: headers() });
    if (!response.ok) throw new Error(`Device authorization failed (${response.status}).`);
    const payload = await response.json();
    document.querySelector("#library-auth").textContent = "Private device access enabled.";
    for (const project of payload.projects) projectSelect.add(new Option(project.name, project.name));
    for (const project of payload.projects) {
      moveDestination.add(new Option(project.name, project.name));
    }
    moveDestination.disabled = false;

    projectSelect.disabled = false;
    const previous = localStorage.getItem("lasu-last-project");
    if (previous && Array.from(projectSelect.options).some(option => option.value === previous)) {
      projectSelect.value = previous;
    } else if (payload.projects.length) {
      projectSelect.value = payload.projects[0].name;
    }
    await loadAssets();
  } catch (error) { message(error.message); }
}
projectSelect.addEventListener("change", () => {
  localStorage.setItem("lasu-last-project", projectSelect.value);
  loadAssets();
});
allButton.addEventListener("click", () => { selected = new Set(assets.map(a => a.path)); updateSelection(); });
clearButton.addEventListener("click", () => { selected.clear(); updateSelection(); });
moveDestination.addEventListener("change", updateSelection);
moveButton.addEventListener("click", async () => {
  const sourceProject = projectSelect.value;
  const destinationProject = moveDestination.value;
  const paths = assets.filter(asset => selected.has(asset.path)).map(asset => asset.path);
  if (!paths.length || !destinationProject || destinationProject === sourceProject || moving) return;
  if (!window.confirm(`Move ${paths.length} selected file(s) from "${sourceProject}" to "${destinationProject}"?`)) return;
  moving = true;
  updateSelection();
  message(`Moving ${paths.length} file(s) to ${destinationProject}…`);
  try {
    const response = await fetch(`${API}/assets/move`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        source_project: sourceProject,
        destination_project: destinationProject,
        paths
      })
    });
    if (!response.ok) {
      let detail = `Move failed (${response.status}).`;
      try {
        const error = await response.json();
        if (typeof error.detail === "string") detail = error.detail;
      } catch (_) {}
      throw new Error(detail);
    }
    const result = await response.json();
    await loadAssets();
    message(`Moved ${result.moved.length} file(s) to ${destinationProject}.`);
  } catch (error) {
    message(`${error.message} Refresh the library to verify any partial moves.`);
  } finally {
    moving = false;
    updateSelection();
  }
});

saveButton.addEventListener("click", () => {
  const chosen = assets.filter(asset => selected.has(asset.path));
  if (!chosen.length) return;
  if (chosen.some(asset => !assetBlobs.has(asset.path))) {
    message("Selected files are still loading. Please wait.");
    return;
  }
  const files = chosen.map(asset => {
    const blob = assetBlobs.get(asset.path);
    return new File([blob], asset.path.split("/").pop(), { type: blob.type });
  });
  if (!navigator.share || !navigator.canShare || !navigator.canShare({ files })) {
    message("This browser cannot share this selection. Try fewer files or one media type.");
    return;
  }
  saveButton.disabled = true;
  message(`Opening device share sheet for ${files.length} file(s)…`);
  navigator.share({ files }).then(
    () => message(`${files.length} file(s) sent to the device share sheet.`),
    error => message(error.name === "AbortError" ? "Sharing cancelled." : error.message)
  ).finally(updateSelection);
});
initialize();

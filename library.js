(() => {
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
const categorySelect = document.querySelector("#library-category");
const cleanupButton = document.querySelector("#cleanup-workspace");
const cleanupReview = document.querySelector("#cleanup-review");
const cleanupProjects = document.querySelector("#cleanup-projects");
const cleanupConfirm = document.querySelector("#cleanup-confirm");
const cleanupCancel = document.querySelector("#cleanup-cancel");

let moving = false;
let saving = false;
let cleaning = false;
let loadSequence = 0;
let cleanupCandidates = [];

let assets = [];
let selected = new Set();
let previewUrls = [];
let assetBlobs = new Map();

function message(value) { status.textContent = value; }
function headers() { return { Authorization: `Bearer ${token}` }; }
function updateSelection() {
  saveButton.disabled = saving || selected.size === 0 || [...selected].some(path => !assetBlobs.has(path));
  moveButton.disabled = moving || cleaning || selected.size === 0 ||
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
  const sequence = ++loadSequence;
  resetGrid();
  const project = projectSelect.value;
  if (!project) return;
  message("Loading private library…");
  try {
    const response = await fetch(`${API}/assets?${new URLSearchParams({ project })}`, { headers: headers() });
    if (!response.ok) throw new Error(`Library lookup failed (${response.status}).`);
    const payload = await response.json();
    if (sequence !== loadSequence) return;
    assets = payload.assets.filter(asset =>
      !categorySelect.value || asset.kind === categorySelect.value
    );
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
      if (sequence !== loadSequence || projectSelect.value !== project) break;
      const card = Array.from(grid.children).find(node => node.dataset.path === asset.path);
      if (!card) continue;
      try {
        const blob = await fetchAsset(asset);
        if (sequence !== loadSequence || projectSelect.value !== project) break;
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
    categorySelect.disabled = false;
    cleanupButton.disabled = false;
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
categorySelect.addEventListener("change", loadAssets);
allButton.addEventListener("click", () => { selected = new Set(assets.map(a => a.path)); updateSelection(); });
clearButton.addEventListener("click", () => { selected.clear(); updateSelection(); });
moveDestination.addEventListener("change", updateSelection);
moveButton.addEventListener("click", async () => {
  const sourceProject = projectSelect.value;
  const destinationProject = moveDestination.value;
  const paths = assets.filter(asset => selected.has(asset.path)).map(asset => asset.path);
  if (!paths.length || !destinationProject || destinationProject === sourceProject || moving || cleaning) return;
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


// Store original media bytes in a standard, uncompressed ZIP archive.
async function buildSelectedZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;
  const limit = 0xffffffff;

  if (!files.length || files.length > 65535) {
    throw new Error("Unsupported archive file count.");
  }

  const table = Uint32Array.from({length: 256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return value >>> 0;
  });

  for (const file of files) {
    const name = encoder.encode(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = bytes.length;

    if (name.length > 65535 ||
        offset + 30 + name.length + size > limit) {
      throw new Error("Selection exceeds ZIP size limits. Select fewer files.");
    }

    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(14, 33, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);

    localParts.push(local.buffer, name, file);
    centralParts.push(central.buffer, name);

    offset += 30 + name.length + size;
    centralSize += 46 + name.length;
  }

  if (offset + centralSize + 22 > limit) {
    throw new Error("Selection exceeds ZIP size limits. Select fewer files.");
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob(
    [...localParts, ...centralParts, end.buffer],
    {type: "application/zip"}
  );
}


saveButton.addEventListener("click", async () => {
  if (saving) return;

  const chosen = assets.filter(asset => selected.has(asset.path));
  if (!chosen.length) return;

  if (chosen.some(asset => !assetBlobs.has(asset.path))) {
    message("Selected files are still loading. Please wait.");
    return;
  }

  const project = projectSelect.value;
  const files = chosen.map(asset => {
    const blob = assetBlobs.get(asset.path);
    return new File(
      [blob],
      `${asset.kind}/${asset.path.split("/").pop()}`,
      {type: blob.type}
    );
  });

  saving = true;
  updateSelection();
  message(`Preparing ${files.length} selected file(s)…`);

  try {
    const archive = await buildSelectedZip(files);
    const url = URL.createObjectURL(archive);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project}-selected.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message(`Download started: ${files.length} file(s) in one ZIP.`);
  } catch (error) {
    message(`Download failed: ${error.message}`);
  } finally {
    saving = false;
    updateSelection();
  }
});

function setCleaning(value) {
  cleaning = value;
  cleanupButton.disabled = value;
  cleanupConfirm.disabled = value;
  cleanupCancel.disabled = value;
  updateSelection();
}

async function cleanupRequest(payload) {
  const options = {headers: headers()};
  if (payload !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(`${API}/assets/cleanup`, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string" ? result.detail : "Cleanup failed."
    );
  }
  return result;
}

cleanupButton.addEventListener("click", async () => {
  if (cleaning || moving) return;
  setCleaning(true);
  cleanupReview.hidden = true;
  message("Checking inactive projects against the permanent archive…");

  try {
    const result = await cleanupRequest();
    cleanupCandidates = result.projects;
    cleanupProjects.replaceChildren();

    if (!cleanupCandidates.length) {
      message("No projects currently qualify for cleanup.");
      return;
    }

    for (const project of cleanupCandidates) {
      const row = document.createElement("label");
      row.style.display = "block";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = project.project;

      row.append(
        checkbox,
        document.createTextNode(
          ` ${project.project} · ${project.files} files · ` +
          `${(project.bytes / 1048576).toFixed(2)} MiB`
        )
      );
      cleanupProjects.append(row);
    }

    cleanupReview.hidden = false;
    message("Select the inactive projects to clean up.");
  } catch (error) {
    message(error.message);
  } finally {
    setCleaning(false);
  }
});

cleanupCancel.addEventListener("click", () => {
  cleanupReview.hidden = true;
  cleanupCandidates = [];
});

cleanupConfirm.addEventListener("click", async () => {
  if (cleaning || moving) return;

  const names = new Set(
    [...cleanupProjects.querySelectorAll("input:checked")].map(input => input.value)
  );

  const projects = cleanupCandidates
    .filter(project => names.has(project.project))
    .map(project => ({
      project: project.project,
      objects: project.objects
    }));

  if (!projects.length) {
    message("Select at least one project.");
    return;
  }

  if (!window.confirm(
    `Remove selected inactive projects from Cloud Workspace?\n\n` +
    `${projects.map(project => project.project).join("\n")}\n\n` +
    `Permanent Gallery copies will be retained.`
  )) return;

  setCleaning(true);
  message("Verifying original and archived files before cleanup…");

  try {
    const result = await cleanupRequest({confirm: true, projects});
    cleanupReview.hidden = true;
    cleanupCandidates = [];

    const response = await fetch(`${API}/projects`, {headers: headers()});
    if (response.ok) {
      const data = await response.json();
      const previous = projectSelect.value;

      projectSelect.replaceChildren(new Option("Choose a project", ""));
      moveDestination.replaceChildren(new Option("Choose destination project", ""));

      for (const project of data.projects) {
        projectSelect.add(new Option(project.name, project.name));
        moveDestination.add(new Option(project.name, project.name));
      }

      if ([...projectSelect.options].some(option => option.value === previous)) {
        projectSelect.value = previous;
      }
    }

    await loadAssets();
    message(
      `Removed ${result.deleted.length} file(s), ` +
      `${(result.bytes_deleted / 1048576).toFixed(2)} MiB. ` +
      (result.remaining
        ? `${result.remaining} file(s) remain. Review again before retrying.`
        : "Permanent archive retained.")
    );
  } catch (error) {
    cleanupReview.hidden = true;
    cleanupCandidates = [];
    await loadAssets();
    message(`${error.message} Review workspace before retrying.`);
  } finally {
    setCleaning(false);
  }
});

initialize();

})();

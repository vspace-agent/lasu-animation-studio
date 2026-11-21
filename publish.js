// Select live cloud audio and visual assets and preview a production manifest.
"use strict";

const API = "https://lasu-animation-516584546026.europe-west3.run.app";
const token = localStorage.getItem("lasu-device-token");
const $ = (selector) => document.querySelector(selector);
const batchSelect = $("#audio-batch");
const projectSelect = $("#visual-project");
const audioContainer = $("#audio-tracks");
const visualContainer = $("#visual-assets");
const reviewButton = $("#review-manifest");
const status = $("#publish-status");
let batches = [];
let visualAssets = [];

function headers() {
  return { Authorization: `Bearer ${token}` };
}

function setStatus(message) {
  status.textContent = message;
}

async function getJSON(path) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  if (response.status === 401) {
    throw new Error("Device pairing expired. Pair this device in Animation Studio.");
  }
  if (!response.ok) throw new Error(`Cloud request failed (${response.status}).`);
  return response.json();
}

function renderAudio() {
  audioContainer.replaceChildren();
  const batch = batches.find((item) => item.id === batchSelect.value);
  if (!batch) return;
  const summary = document.createElement("p");
  summary.textContent = `${batch.tracks.length} tracks · ${batch.recording_count} available recordings`;
  audioContainer.append(summary);

  for (const track of batch.tracks) {
    const label = document.createElement("label");
    label.className = "publish-track";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "audio-track-selection";
    check.value = track.name;
    check.checked = true;
    const description = document.createElement("span");
    description.textContent = `${track.name.replace(/^track_\d+_/, "").replaceAll("_", " ")} · ${track.recordings.length} recording(s)`;
    label.append(check, description);
    audioContainer.append(label);
  }
  reviewButton.disabled = false;
}

async function loadAudio() {
  const result = await getJSON("/audio/batches");
  batches = result.batches;
  batchSelect.replaceChildren(new Option("Choose a batch", ""));
  for (const batch of batches) {
    const theme = typeof batch.theme === "string" && batch.theme.trim()
      ? batch.theme.trim().replaceAll("_", " ")
      : "Untitled batch";
    const shortId = batch.id.replace("studio_batch_", "").slice(0, 8);
    const label = `${theme} · ${shortId} · ${batch.tracks.length} tracks · ${batch.recording_count} recordings`;
    batchSelect.add(new Option(label, batch.id));
  }
  batchSelect.disabled = batches.length === 0;
  if (batches.length) {
    batchSelect.value = batches[batches.length - 1].id;
    renderAudio();
  } else {
    audioContainer.textContent = "No audio recordings are currently present in cloud storage.";
  }
}

function renderVisuals() {
  visualContainer.replaceChildren();
  const summary = document.createElement("p");
  summary.textContent = `${visualAssets.length} available visual assets`;
  visualContainer.append(summary);
  for (const asset of visualAssets) {
    const label = document.createElement("label");
    label.className = "publish-asset";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "publish-visual";
    radio.value = asset.path;
    const description = document.createElement("span");
    description.textContent = `${asset.kind.toUpperCase()} · ${asset.path.split("/").pop()}`;
    label.append(radio, description);
    visualContainer.append(label);
  }
  const first = visualContainer.querySelector('input[name="publish-visual"]');
  if (first) first.checked = true;
}

async function loadVisuals() {
  visualAssets = [];
  visualContainer.replaceChildren();
  if (!projectSelect.value) return;
  const query = new URLSearchParams({ project: projectSelect.value });
  const result = await getJSON(`/assets?${query}`);
  visualAssets = result.assets.filter((asset) => ["sprite", "gif", "mp4"].includes(asset.kind));
  renderVisuals();
}

async function loadProjects() {
  const result = await getJSON("/projects");
  projectSelect.replaceChildren(new Option("Choose a visual project", ""));
  for (const project of result.projects) {
    projectSelect.add(new Option(project.name, project.name));
  }
  projectSelect.disabled = result.projects.length === 0;
  const last = localStorage.getItem("lasu-last-project");
  if (result.projects.length) {
    projectSelect.value = result.projects.some((item) => item.name === last)
      ? last : result.projects[0].name;
    await loadVisuals();
  }
}

function previewManifest() {
  const batch = batches.find((item) => item.id === batchSelect.value);
  if (!batch) throw new Error("Choose an available audio batch.");
  const selectedTracks = new Set(
    [...audioContainer.querySelectorAll(".audio-track-selection:checked")].map((input) => input.value)
  );
  const tracks = batch.tracks
    .filter((track) => selectedTracks.has(track.name))
    .map((track) => ({
      name: track.name,
      recordings: track.recordings.map((recording) => recording.path),
    }));
  if (!tracks.length) throw new Error("Select at least one audio track.");
  const chosenVisual = visualContainer.querySelector('input[name="publish-visual"]:checked');
  if (!chosenVisual) throw new Error("Select a visual asset.");
  const asset = visualAssets.find((item) => item.path === chosenVisual.value);
  if (!asset) throw new Error("Selected visual asset is no longer listed.");
  const internalFade = Number($("#internal-fade").value);
  const groupFade = Number($("#group-fade").value);
  if (![internalFade, groupFade].every((value) => Number.isFinite(value) && value > 0 && value <= 10)) {
    throw new Error("Crossfade durations must be greater than 0 and at most 10 seconds.");
  }
  const title = $("#video-title").value.trim();
  if (!title || title.length > 100) throw new Error("Enter a YouTube title (up to 100 characters).");

  return {
    schema_version: 1,
    audio: { bucket: "mushroom-house-studio-audio-staging", batch: batch.id, tracks },
    visual: {
      bucket: "mushroom-house-visual-assets",
      project: projectSelect.value,
      path: asset.path,
      kind: asset.kind,
      playback: $("#visual-mode").value,
    },
    composition: {
      trim_boundaries: $("#trim-boundaries").checked,
      internal_crossfade_seconds: internalFade,
      group_crossfade_seconds: groupFade,
    },
    publication: {
      channel: "D_昧Mei",
      playlist: "For a good day",
      title,
      description: $("#video-description").value,
      visibility: $("#publication-public").checked ? "public" : "private",
    },
  };
}

batchSelect.addEventListener("change", renderAudio);
projectSelect.addEventListener("change", async () => {
  localStorage.setItem("lasu-last-project", projectSelect.value);
  try {
    await loadVisuals();
  } catch (error) {
    setStatus(error.message);
  }
});
reviewButton.addEventListener("click", () => {
  try {
    $("#manifest-preview").textContent = JSON.stringify(previewManifest(), null, 2);
    setStatus("Production manifest ready for review. Cloud submission is not connected yet.");
  } catch (error) {
    $("#manifest-preview").textContent = "";
    setStatus(error.message);
  }
});

async function initialize() {
  if (!token) {
    $("#publish-auth").textContent = "Pair this device in Animation Studio to access private cloud assets.";
    setStatus("Device pairing required.");
    return;
  }
  try {
    await Promise.all([loadAudio(), loadProjects()]);
    $("#publish-auth").textContent = "Private cloud access enabled.";
    setStatus("Choose the recordings and visual, then review the production manifest.");
  } catch (error) {
    $("#publish-auth").textContent = error.message;
    setStatus("Could not load private cloud assets.");
    reviewButton.disabled = true;
  }
}
initialize();

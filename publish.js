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

function themeKey(batch) {
  return batch.theme || `untitled:${batch.id}`;
}

function routeLabel(route) {
  return { turbo: "Turbo", sft_lm: "SFT+LM" }[route] || "Unknown model";
}

function renderAudio() {
  audioContainer.replaceChildren();
  const matching = batches.filter((batch) => themeKey(batch) === batchSelect.value);
  if (!matching.length) {
    reviewButton.disabled = true;
    return;
  }

  const totalTracks = matching.reduce((sum, batch) => sum + batch.tracks.length, 0);
  const totalRecordings = matching.reduce((sum, batch) => sum + batch.recording_count, 0);
  const summary = document.createElement("p");
  summary.textContent = `${matching.length} generation runs · ${totalTracks} tracks · ${totalRecordings} recordings`;
  audioContainer.append(summary);

  const routes = ["turbo", "sft_lm", ...new Set(matching.map((batch) => batch.route))];
  for (const route of [...new Set(routes)]) {
    const runs = matching.filter((batch) => batch.route === route);
    if (!runs.length) continue;
    const group = document.createElement("section");
    group.className = "publish-model-group";
    const heading = document.createElement("h3");
    heading.textContent = `${routeLabel(route)} · ${runs.length} generation run(s)`;
    group.append(heading);

    for (const batch of runs) {
      const run = document.createElement("div");
      run.className = "publish-generation-run";
      const runTitle = document.createElement("p");
      runTitle.textContent = `Run ${batch.id.replace("studio_batch_", "").slice(0, 8)} · ${batch.recording_count} recordings`;
      run.append(runTitle);

      for (const track of batch.tracks) {
        const label = document.createElement("label");
        label.className = "publish-track";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "audio-track-selection";
        check.dataset.batchId = batch.id;
        check.dataset.trackName = track.name;
        check.checked = true;
        const description = document.createElement("span");
        description.textContent = `${track.name.replace(/^track_\\d+_/, "").replaceAll("_", " ")} · ${track.recordings.length} recording(s)`;
        label.append(check, description);
        run.append(label);
      }
      group.append(run);
    }
    audioContainer.append(group);
  }
  reviewButton.disabled = false;
}

async function loadAudio() {
  const result = await getJSON("/audio/batches");
  batches = result.batches;
  batchSelect.replaceChildren(new Option("Choose a story theme", ""));
  const themes = new Map();
  for (const batch of batches) {
    const key = themeKey(batch);
    if (!themes.has(key)) themes.set(key, []);
    themes.get(key).push(batch);
  }
  for (const [key, runs] of [...themes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = runs[0].theme
      ? runs[0].theme.replaceAll("_", " ")
      : `Untitled batch · ${runs[0].id.replace("studio_batch_", "").slice(0, 8)}`;
    const count = runs.reduce((sum, batch) => sum + batch.recording_count, 0);
    batchSelect.add(new Option(`${name} · ${runs.length} runs · ${count} recordings`, key));
  }
  batchSelect.disabled = themes.size === 0;
  if (themes.size) {
    const last = batches[batches.length - 1];
    batchSelect.value = themeKey(last);
    renderAudio();
  } else {
    audioContainer.textContent = "No audio recordings are currently present in cloud storage.";
  }
}

// Display private visual objects using the Cloud Library's authenticated preview method.
let visualPreviewUrls = [];
let visualLoadVersion = 0;

function clearVisualPreviews() {
  visualLoadVersion += 1;
  for (const url of visualPreviewUrls) URL.revokeObjectURL(url);
  visualPreviewUrls = [];
  visualContainer.replaceChildren();
}

function visualAssetParams(asset, project) {
  const name = asset.path.split("/").pop();
  const match = /^([0-9a-f]{64})\.(png|jpg|gif|mp4)$/.exec(name);
  if (!match) throw new Error("Invalid stored visual asset name.");
  return new URLSearchParams({
    project, kind: asset.kind, digest: match[1], extension: match[2]
  });
}

async function loadVisuals() {
  clearVisualPreviews();
  visualAssets = [];
  const project = projectSelect.value;
  if (!project) return;
  const version = visualLoadVersion;
  const result = await getJSON(`/assets?${new URLSearchParams({ project })}`);
  if (version !== visualLoadVersion) return;

  visualAssets = result.assets.filter((asset) =>
    ["gif", "mp4"].includes(asset.kind)
  );

  const summary = document.createElement("p");
  summary.textContent = `${visualAssets.length} available visual assets · choose one`;
  visualContainer.append(summary);

  const grid = document.createElement("div");
  grid.className = "library-grid publish-visual-grid";
  visualContainer.append(grid);

  for (const asset of visualAssets) {
    const card = document.createElement("label");
    card.className = "library-card publish-visual-card";
    card.dataset.path = asset.path;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "publish-visual";
    radio.value = asset.path;
    radio.setAttribute("aria-label", `Select ${asset.kind} ${asset.path.split("/").pop()}`);
    radio.addEventListener("change", () => {
      for (const item of grid.querySelectorAll(".library-card")) {
        item.classList.toggle("selected", item.querySelector("input").checked);
      }
    });
    card.append(radio);

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

  const first = grid.querySelector('input[name="publish-visual"]');
  if (first) {
    first.checked = true;
    first.closest(".library-card").classList.add("selected");
  }

  // Like Cloud Library, load each private preview with the paired device token.
  for (const asset of visualAssets) {
    if (version !== visualLoadVersion) return;
    const card = Array.from(grid.children).find(
      (item) => item.dataset.path === asset.path
    );
    if (!card) continue;
    try {
      const response = await fetch(
        `${API}/assets/file?${visualAssetParams(asset, project)}`,
        { headers: headers() }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (version !== visualLoadVersion) return;
      const url = URL.createObjectURL(blob);
      visualPreviewUrls.push(url);
      card.querySelector("img,video").src = url;
    } catch (_) {
      if (version !== visualLoadVersion) return;
      card.querySelector(".caption").textContent += " · Preview unavailable";
    }
  }
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
  const selected = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const selectedKeys = new Set(
    selected.map((input) => `${input.dataset.batchId}/${input.dataset.trackName}`)
  );
  const selectedBatches = batches
    .filter((batch) => themeKey(batch) === batchSelect.value)
    .map((batch) => ({
      id: batch.id,
      route: batch.route,
      tracks: batch.tracks
        .filter((track) => selectedKeys.has(`${batch.id}/${track.name}`))
        .map((track) => ({
          name: track.name,
          recordings: track.recordings.map((recording) => recording.path),
        })),
    }))
    .filter((batch) => batch.tracks.length);
  const tracks = selectedBatches.flatMap((batch) => batch.tracks);
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
    schema_version: 2,
    audio: {
      bucket: "mushroom-house-studio-audio-staging",
      theme: batches.find((batch) => themeKey(batch) === batchSelect.value)?.theme || null,
      batches: selectedBatches,
    },
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

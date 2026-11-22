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
let selectedGifPaths = [];

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

// Build audience-facing copy from the original story and music prompts; never invent chapter times.
function generatePublicationDescription() {
  const chosen = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const keys = new Set(chosen.map((input) => `${input.dataset.batchId}/${input.dataset.trackName}`));
  const selectedRuns = batches.filter((batch) => themeKey(batch) === batchSelect.value)
    .map((batch) => ({
      ...batch,
      tracks: batch.tracks.filter((track) => keys.has(`${batch.id}/${track.name}`)),
    })).filter((batch) => batch.tracks.length);
  if (!selectedRuns.length) return "";

  const story = selectedRuns.map((batch) => batch.story?.trim()).find(Boolean);
  const descriptions = selectedRuns.flatMap((batch) =>
    batch.tracks.map((track) => batch.music_prompts?.[track.name]?.trim()).filter(Boolean)
  );
  // Use only the shared instrumental palette; individual prompts are production data.
  const palette = descriptions.map((prompt) =>
    prompt.split(/\.\s+/)[1]?.trim()
  ).filter(Boolean);
  const sharedPalette = palette.length && palette.every((item) => item === palette[0])
    ? palette[0].replace(/[.\s]+$/, "")
    : "";
  const musicDescription = sharedPalette
    ? `Instrumental music featuring ${sharedPalette.charAt(0).toLowerCase()}${sharedPalette.slice(1)}.`
    : "";

  const lines = [
    "For a good day | Story-Based Background Music",
    "Mood Regulation • Long Listening",
    "",
    ...(story ? [story, ""] : []),
    ...(musicDescription ? [musicDescription, ""] : []),
    "Base model generation + sound programming by Mushroom House Studio.",
    "",
    "Made at Mushroom House 🍄 Studio.",
  ];
  return lines.join("\n");
}

function publicationSourceWarnings() {
  const chosen = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const keys = new Set(chosen.map((input) => `${input.dataset.batchId}/${input.dataset.trackName}`));
  const runs = batches.filter((batch) => themeKey(batch) === batchSelect.value)
    .filter((batch) => batch.tracks.some((track) =>
      keys.has(`${batch.id}/${track.name}`)));
  const missing = [];
  if (runs.length && !runs.some((batch) => batch.story?.trim())) {
    missing.push("Original batch story unavailable from the audio API.");
  }
  if (runs.length && !runs.some((batch) => batch.tracks.some((track) =>
      keys.has(`${batch.id}/${track.name}`) && batch.music_prompts?.[track.name]?.trim()))) {
    missing.push("Original music prompts unavailable from the audio API.");
  }
  return missing;
}

let descriptionEdited = false;
function refreshPublicationDescription(force = false) {
  if (descriptionEdited && !force) return;
  $("#video-description").value = generatePublicationDescription();
  const warnings = publicationSourceWarnings();
  $("#description-note").textContent = warnings.length
    ? `Missing source data: ${warnings.join(" ")} Edit the draft before publication.`
    : "Draft uses original batch story and music prompts. Edit before publication; verified chapter timestamps are added after composition.";
  descriptionEdited = false;
}

$("#video-description").addEventListener("input", () => { descriptionEdited = true; });
$("#regenerate-description").addEventListener("click", () => refreshPublicationDescription(true));

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
    const group = document.createElement("details");
    group.className = "publish-model-group";
    const heading = document.createElement("summary");
    const modelRecordings = runs.reduce((sum, batch) => sum + batch.recording_count, 0);
    heading.textContent = `${routeLabel(route)} · ${runs.length} runs · ${modelRecordings} recordings`;
    group.append(heading);

    const controls = document.createElement("div");
    controls.className = "publish-model-controls";
    for (const [label, checked] of [["Select all music", true], ["Clear selection", false]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        for (const input of group.querySelectorAll(".audio-track-selection")) {
          input.checked = checked && !input.dataset.trackName.startsWith("track_01_");
        }
        $("#publishing-preset").value = "manual";
        $("#manifest-preview").textContent = "";
        refreshPublicationDescription();
        setStatus("Audio selection changed. Review the manifest again.");
      });
      controls.append(button);
    }
    group.append(controls);

    for (const batch of runs) {
      const run = document.createElement("details");
      run.className = "publish-generation-run";
      const runTitle = document.createElement("summary");
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
        check.checked = $("#publishing-preset").value === "turbo_long_listen"
          ? batch.route === "turbo" && !/^track_01_/.test(track.name)
          : false;
        const description = document.createElement("span");
        description.textContent = `${track.name.replace(/^track_\\d+_/, "").replaceAll("_", " ")} · ${track.recordings.length} recording(s)`;
        label.append(check, description);
        check.addEventListener("change", () => {
          $("#publishing-preset").value = "manual";
          $("#manifest-preview").textContent = "";
          refreshPublicationDescription();
        });
        run.append(label);
      }
      group.append(run);
    }
    audioContainer.append(group);
  }
  reviewButton.disabled = false;
  refreshPublicationDescription();
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

function renderGifOrder() {
  const list = $("#visual-order");
  list.replaceChildren();
  $("#visual-order-count").textContent =
    `${selectedGifPaths.length} GIF(s) selected · playback order`;

  for (const [index, path] of selectedGifPaths.entries()) {
    const item = document.createElement("li");
    item.className = "publish-ordered-gif";
    const number = document.createElement("strong");
    number.className = "publish-order-number";
    number.textContent = String(index + 1);
    const name = document.createElement("span");
    name.className = "publish-order-label";
    name.textContent = `${path.split("/").pop().slice(0, 12)}…`;
    name.title = path;

    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.setAttribute("aria-label", `Move GIF ${index + 1} earlier`);
    up.disabled = index === 0;
    up.addEventListener("click", () => moveGif(index, index - 1));

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.setAttribute("aria-label", `Move GIF ${index + 1} later`);
    down.disabled = index === selectedGifPaths.length - 1;
    down.addEventListener("click", () => moveGif(index, index + 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove GIF ${index + 1}`);
    remove.addEventListener("click", () => {
      selectedGifPaths.splice(index, 1);
      updateGifSelection();
    });
    item.append(number, name, up, down, remove);
    list.append(item);
  }
}

function moveGif(from, to) {
  if (to < 0 || to >= selectedGifPaths.length) return;
  const [path] = selectedGifPaths.splice(from, 1);
  selectedGifPaths.splice(to, 0, path);
  updateGifSelection();
}

function updateGifSelection() {
  for (const card of visualContainer.querySelectorAll(".publish-visual-card")) {
    const index = selectedGifPaths.indexOf(card.dataset.path);
    const chosen = index >= 0;
    card.classList.toggle("selected", chosen);
    card.querySelector('input[type="checkbox"]').checked = chosen;
    card.querySelector(".publish-card-order").textContent =
      chosen ? String(index + 1) : "";
  }
  renderGifOrder();
  $("#save-gif-selection").disabled = selectedGifPaths.length === 0;
}

async function loadVisuals() {
  clearVisualPreviews();
  visualAssets = [];
  selectedGifPaths = [];
  updateGifSelection();
  const project = projectSelect.value;
  if (!project) return;
  const version = visualLoadVersion;
  const result = await getJSON(`/assets?${new URLSearchParams({ project })}`);
  if (version !== visualLoadVersion) return;

  // The first GIF composer accepts GIFs, not spritesheets or MP4s.
  visualAssets = result.assets.filter((asset) => asset.kind === "gif");

  const summary = document.createElement("p");
  summary.textContent =
    `${visualAssets.length} GIF(s) available · select in playback order`;
  visualContainer.append(summary);

  const grid = document.createElement("div");
  grid.className = "library-grid publish-visual-grid";
  visualContainer.append(grid);

  for (const asset of visualAssets) {
    const card = document.createElement("label");
    card.className = "library-card publish-visual-card";
    card.dataset.path = asset.path;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute(
      "aria-label", `Select GIF ${asset.path.split("/").pop()}`
    );
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && !selectedGifPaths.includes(asset.path)) {
        selectedGifPaths.push(asset.path);
      } else if (!checkbox.checked) {
        selectedGifPaths = selectedGifPaths.filter((path) => path !== asset.path);
      }
      updateGifSelection();
    });
    card.append(checkbox);

    const badge = document.createElement("span");
    badge.className = "publish-card-order";
    badge.setAttribute("aria-hidden", "true");
    card.append(badge);

    const media = document.createElement("img");
    media.alt = "Animated GIF preview";
    media.loading = "lazy";
    card.append(media);

    const caption = document.createElement("span");
    caption.className = "caption";
    caption.textContent = `GIF · ${asset.path.split("/").pop().slice(0, 12)}… · ${(asset.size / 1024).toFixed(0)} KB`;
    card.append(caption);
    grid.append(card);
  }

  // Reuse Cloud Library's authenticated private media loading.
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
      card.querySelector("img").src = url;
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
  if (!selectedGifPaths.length) throw new Error("Select at least one GIF.");
  if (selectedGifPaths.some((path) =>
    !visualAssets.some((asset) => asset.kind === "gif" && asset.path === path)
  )) throw new Error("The GIF selection no longer matches this project.");
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
      kind: "gif",
      gif_paths: [...selectedGifPaths],
      playback: "loop_per_track",
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

$("#save-gif-selection").addEventListener("click", async () => {
  const button = $("#save-gif-selection");
  const feedback = $("#gif-save-status");
  const project = projectSelect.value;
  const gifPaths = [...selectedGifPaths];
  if (!project || !gifPaths.length) {
    feedback.textContent = "Select at least one GIF before saving.";
    return;
  }
  button.disabled = true;
  feedback.textContent = "Saving ordered selection to private cloud log…";
  try {
    const response = await fetch(`${API}/publishing/selections`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        gif_paths: gifPaths,
        audio_theme: batches.find((batch) =>
          themeKey(batch) === batchSelect.value)?.theme || null,
        audio_model: null
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Save failed (${response.status}).`);
    }
    const saved = await response.json();
    if (saved.project !== project ||
        JSON.stringify(saved.gif_paths) !== JSON.stringify(gifPaths) ||
        !/^[0-9a-f]{32}$/.test(saved.selection_id)) {
      throw new Error("Saved selection response did not match the requested order.");
    }
    feedback.textContent =
      `Saved ${gifPaths.length} GIF(s) in order · Log ID: ${saved.selection_id}`;
    console.info("Lasu publishing selection log:", saved.selection_id);
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = selectedGifPaths.length === 0;
  }
});

batchSelect.addEventListener("change", () => {
  descriptionEdited = false;
  renderAudio();
});
$("#publishing-preset").addEventListener("change", () => {
  descriptionEdited = false;
  renderAudio();
  $("#manifest-preview").textContent = "";
  setStatus("Automation selection updated. Review the production manifest.");
});
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
    refreshPublicationDescription();
    $("#publish-auth").textContent = "Private cloud access enabled.";
    setStatus("Choose the recordings and visual, then review the production manifest.");
  } catch (error) {
    $("#publish-auth").textContent = error.message;
    setStatus("Could not load private cloud assets.");
    reviewButton.disabled = true;
  }
}
initialize();

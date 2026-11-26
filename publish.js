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
const submitButton = $("#submit-production");
let reviewedManifestJSON = null;
let activeProductionID = localStorage.getItem("lasu-active-automation") || "";
let automationTimer = null;
let automationStatusBusy = false;
let submissionUnconfirmed = localStorage.getItem("lasu-submission-unconfirmed") === "true";
let submissionInProgress = false;

function invalidateReview() {
  reviewedManifestJSON = null;
  submitButton.disabled = true;
  $("#manifest-preview").textContent = "";
}

const reviewInputIds = new Set([
  "audio-batch", "visual-project", "publishing-preset",
  "trim-boundaries", "internal-fade", "group-fade", "jazz-refiner-preset",
  "video-title", "video-description", "publication-public",
  "youtube-channel", "youtube-playlist"
]);

for (const eventName of ["input", "change"]) {
  document.addEventListener(eventName, (event) => {
    if (reviewInputIds.has(event.target.id) ||
        event.target.classList?.contains("audio-track-selection")) {
      invalidateReview();
    }
  });
}
const taskPanel = $("#publish-task-report");
const taskStage = $("#publish-task-stage");
const taskMessage = $("#publish-task-message");
const taskProgress = $("#publish-task-progress");
const taskPercentage = $("#publish-task-percentage");
const taskError = $("#publish-task-error");
const copyErrorButton = $("#copy-publish-error");
let lastPublishError = "";

function updateTaskReport(stage, message, percent = null) {
  taskStage.textContent = stage;
  taskMessage.textContent = message;
  const measured = Number.isFinite(percent);
  taskProgress.hidden = !measured;
  taskPercentage.hidden = !measured;
  if (measured) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    taskProgress.value = value;
    taskPercentage.textContent = `Request upload: ${value}%`;
  }
  taskError.hidden = true;
  $("#copy-publish-feedback").textContent = "";
}

function reportSubmissionError(error, phase, httpStatus = null, detail = null) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostic = {
    operation: "POST /publishing/productions",
    stage: phase,
    http_status: httpStatus,
    error: message,
    server_detail: detail,
    timestamp: new Date().toISOString(),
    page: window.location.pathname,
    stack: error instanceof Error ? error.stack || null : null,
  };
  lastPublishError = JSON.stringify(diagnostic, null, 2);
  updateTaskReport("Error", "Cloud submission failed. Copy the error report for diagnosis.");
  taskError.hidden = false;
  taskPanel.open = true;
}

copyErrorButton.addEventListener("click", async () => {
  if (!lastPublishError) return;
  const feedback = $("#copy-publish-feedback");
  try {
    await navigator.clipboard.writeText(lastPublishError);
    feedback.textContent = "Copied.";
  } catch (_) {
    const input = document.createElement("textarea");
    input.value = lastPublishError;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    feedback.textContent = copied ? "Copied." : "Copy unavailable in this browser.";
  }
});

// XMLHttpRequest reports actual request-body bytes; server-side validation has no percentage API.
function submitReviewedManifest(snapshot, onUploadProgress, onStage) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/publishing/productions`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 120000;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onUploadProgress(100 * event.loaded / event.total);
      }
    });
    xhr.upload.addEventListener("load", () => {
      onStage("Verifying", "Request uploaded. Checking selected cloud assets and saving the manifest.");
    });
    xhr.addEventListener("load", () => {
      let payload;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch (_) {
        const error = new Error(`Unexpected API response (HTTP ${xhr.status}).`);
        error.httpStatus = xhr.status;
        error.serverDetail = xhr.responseText.slice(0, 1500);
        reject(error);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = payload.detail ?? payload;
        const error = new Error(
          typeof detail === "string" ? detail : `Cloud submission failed (HTTP ${xhr.status}).`
        );
        error.httpStatus = xhr.status;
        error.serverDetail = detail;
        reject(error);
        return;
      }
      resolve(payload);
    });
    for (const [eventName, message] of [
      ["error", "Network error while contacting the production API."],
      ["timeout", "The production API did not respond in time."],
      ["abort", "Cloud submission was interrupted."],
    ]) {
      xhr.addEventListener(eventName, () => reject(new Error(message)));
    }
    xhr.send(snapshot);
  });
}

const status = $("#publish-status");
let batches = [];
let visualAssets = [];
let selectedGifPaths = [];
let visualCompositionDraft = null;
const composerButton = $("#open-visual-composer");
const composerStage = $("#visual-composer-stage");
const composerFrame = $("#visual-composer-frame");
const composerStatus = $("#visual-composer-status");

function currentComposeSelection() {
  return { schema_version: 1, project: projectSelect.value,
    assets: selectedGifPaths.map(path => ({ path, kind: "gif" })) };
}
function invalidateVisualComposition() {
  visualCompositionDraft = null;
  invalidateReview();
  composerStage.hidden = true;
  composerFrame.removeAttribute("src");
  composerStatus.textContent = "Visual selection changed; reopen Compose to refine.";
}

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
  const matching = batches.filter(batch => themeKey(batch) === batchSelect.value);
  if (!matching.length) return "";
  const selectedRuns = selectedAudioBatches().map(selection => {
    const source = matching.find(batch =>
      batch.id === selection.id && batch.route === selection.route
    );
    return { ...source, tracks: selection.tracks };
  });
  const story = matching.map(batch => batch.story?.trim()).find(Boolean);
  if ($("#publishing-preset").value === "sft_lm_review") return story || "";
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
  const runs = batches.filter(batch => themeKey(batch) === batchSelect.value);
  return runs.length && !runs.some(batch => batch.story?.trim())
    ? ["Original batch story unavailable from the audio API."]
    : [];
}

// Public destination options are verified metadata; uploading additionally requires matching channel OAuth.
let youtubeCatalog = null;
const youtubeChannel = $("#youtube-channel");
const youtubePlaylist = $("#youtube-playlist");
const DEFAULT_CHANNEL = "UCLgSpraIniX8rbDhGYWHIMA";
const DEFAULT_PLAYLISTS = {
  turbo: "PLM6FxJNIFPis",
  sft_lm: "PLbrELMMTlxxM",
};
function chosenPlaylist() {
  return youtubeCatalog?.channels
    .find((channel) => channel.id === youtubeChannel.value)?.playlists
    .find((playlist) => playlist.id === youtubePlaylist.value);
}
function refreshPlaylistChoices(preferred = "") {
  const channel = youtubeCatalog?.channels.find((item) => item.id === youtubeChannel.value);
  youtubePlaylist.replaceChildren(new Option("Choose a playlist", ""));
  for (const playlist of channel?.playlists || []) {
    youtubePlaylist.add(new Option(playlist.title, playlist.id));
  }
  const model = $("#publishing-preset").value === "sft_lm_review" ? "sft_lm" : "turbo";
  const requested = preferred || (channel?.id === DEFAULT_CHANNEL ? DEFAULT_PLAYLISTS[model] : "");
  youtubePlaylist.value = channel?.playlists.some((item) => item.id === requested) ? requested : "";
  updateDestinationNotice();
}
function updateDestinationNotice() {
  const channel = youtubeCatalog?.channels.find((item) => item.id === youtubeChannel.value);
  const playlist = chosenPlaylist();
  const supported = channel?.id === DEFAULT_CHANNEL;
  $("#publication-destination").textContent = !channel
    ? "Choose a YouTube channel and playlist."
    : !supported
      ? `${channel.title}: channel verified; cloud publishing authorization not yet connected.`
      : playlist
        ? `Destination: ${channel.title} · Playlist: ${playlist.title}`
        : "Choose a playlist.";
}
async function loadYoutubeDestinations() {
  const response = await fetch("./youtube_destinations.json?v=youtube-choices-04", { cache: "no-store" });
  if (!response.ok) throw new Error("YouTube destination catalog unavailable.");
  const catalog = await response.json();
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.channels)) {
    throw new Error("Invalid YouTube destination catalog.");
  }
  youtubeCatalog = catalog;
  youtubeChannel.replaceChildren(new Option("Choose a channel", ""));
  for (const channel of catalog.channels) {
    youtubeChannel.add(new Option(channel.title, channel.id));
  }
  youtubeChannel.value = DEFAULT_CHANNEL;
  refreshPlaylistChoices();
}
youtubeChannel.addEventListener("change", () => {
  refreshPlaylistChoices();
  invalidateReview();
});
youtubePlaylist.addEventListener("change", () => {
  updateDestinationNotice();
  invalidateReview();
});

let descriptionEdited = false;
function refreshPublicationDescription(force = false) {
  invalidateReview();
  if (descriptionEdited && !force) return;
  const sft = $("#publishing-preset").value === "sft_lm_review";
  updateDestinationNotice();
  $("#video-description").value = generatePublicationDescription();
  const warnings = publicationSourceWarnings();
  $("#description-note").textContent = warnings.length
    ? `Missing source data: ${warnings.join(" ")} Edit the draft before publication.`
    : sft
      ? "Description contains only the original batch story."
      : "Draft uses original batch story and music prompts. Edit before publication; verified chapter timestamps are added after composition.";
  descriptionEdited = false;
}

$("#video-description").addEventListener("input", () => { descriptionEdited = true; });
$("#regenerate-description").addEventListener("click", () => refreshPublicationDescription(true));


function selectedAudioBatches() {
  const mode = $("#publishing-preset").value;
  const route = mode === "sft_lm_review" ? "sft_lm"
    : mode === "turbo_long_listen" ? "turbo" : null;
  const keys = new Set(
    [...audioContainer.querySelectorAll(".audio-track-selection:checked")]
      .map(input => JSON.stringify([
        input.dataset.batchId, input.dataset.route, input.dataset.trackName
      ]))
  );
  return batches
    .filter(batch => themeKey(batch) === batchSelect.value)
    .filter(batch => route ? batch.route === route : ["turbo", "sft_lm"].includes(batch.route))
    .map(batch => ({
      id: batch.id,
      route: batch.route,
      tracks: batch.tracks
        .filter(track => track.name !== "track_01_batch_story")
        .filter(track => route || keys.has(JSON.stringify([
          batch.id, batch.route, track.name
        ])))
        .map(track => ({
          name: track.name,
          recordings: track.recordings.map(recording => recording.path)
        }))
        .filter(track => track.recordings.length)
    }))
    .filter(batch => batch.tracks.length);
}

function updateAudioCount() {
  const count = selectedAudioBatches().reduce(
    (sum, batch) => sum + batch.tracks.reduce(
      (total, track) => total + track.recordings.length, 0
    ), 0
  );
  const summary = $("#selected-audio-count");
  if (summary) summary.textContent = `${count} recordings`;
}

function renderAudio() {
  invalidateReview();
  audioContainer.replaceChildren();

  const summary = document.createElement("p");
  summary.id = "selected-audio-count";
  audioContainer.append(summary);

  if ($("#publishing-preset").value === "manual") {
    for (const batch of batches.filter(batch =>
      themeKey(batch) === batchSelect.value &&
      ["turbo", "sft_lm"].includes(batch.route)
    )) {
      const group = document.createElement("details");
      const heading = document.createElement("summary");
      heading.textContent = routeLabel(batch.route);
      group.append(heading);

      for (const track of batch.tracks) {
        if (track.name === "track_01_batch_story") continue;
        const label = document.createElement("label");
        label.className = "publish-track";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "audio-track-selection";
        check.dataset.batchId = batch.id;
        check.dataset.route = batch.route;
        check.dataset.trackName = track.name;

        const title = document.createElement("span");
        title.textContent = `${track.name.replace(/^track_\d+_/, "").replaceAll("_", " ")} · ${track.recordings.length}`;
        label.append(check, title);
        group.append(label);

        check.addEventListener("change", () => {
          if (check.checked) {
            for (const other of audioContainer.querySelectorAll(".audio-track-selection")) {
              if (other.dataset.route !== check.dataset.route) other.checked = false;
            }
          }
          updateAudioCount();
          refreshPublicationDescription();
        });
      }
      audioContainer.append(group);
    }
  }

  updateAudioCount();
  reviewButton.disabled = Boolean(activeProductionID) ||
    submissionInProgress || submissionUnconfirmed || !selectedAudioBatches().length;
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
    batchSelect.add(new Option(name, key));
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
  invalidateReview();
  invalidateVisualComposition();
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
  composerButton.disabled = selectedGifPaths.length === 0;
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


// Independent visual source selection; never modify the selected GIF order.
const visualSourceMode = $("#visual-source-mode");
const coverFileInput = $("#cover-image-file");
const coverPreview = $("#cover-image-preview");
const coverStatus = $("#cover-image-status");
const removeCoverButton = $("#remove-cover-image");

let coverAsset = null;
let coverObjectURL = null;
let coverUploadController = null;
let coverSelectionVersion = 0;

function clearCoverImage() {
  coverSelectionVersion++;
  coverUploadController?.abort();
  coverUploadController = null;
  coverAsset = null;
  coverFileInput.value = "";
  if (coverObjectURL) URL.revokeObjectURL(coverObjectURL);
  coverObjectURL = null;
  coverPreview.removeAttribute("src");
  coverPreview.hidden = true;
  removeCoverButton.disabled = true;
  coverStatus.textContent = "";
  invalidateReview();
}

visualSourceMode.addEventListener("change", () => {
  const coverMode = visualSourceMode.value === "cover";
  $("#cover-image-panel").hidden = !coverMode;
  $("#gif-visual-panel").hidden = coverMode;
  invalidateReview();
});

removeCoverButton.addEventListener("click", clearCoverImage);

coverFileInput.addEventListener("change", async () => {
  const file = coverFileInput.files?.[0];
  clearCoverImage();
  if (!file) return;

  if (!file.size || file.size > 20 * 1024 * 1024) {
    coverStatus.textContent = "Choose a non-empty image no larger than 20 MiB.";
    return;
  }

  const version = coverSelectionVersion;
  const controller = new AbortController();
  coverUploadController = controller;
  removeCoverButton.disabled = false;

  coverObjectURL = URL.createObjectURL(file);
  coverPreview.onerror = () => {
    if (version !== coverSelectionVersion) return;
    coverPreview.hidden = true;
  };
  coverPreview.onload = () => {
    if (version === coverSelectionVersion) coverPreview.hidden = false;
  };
  coverPreview.src = coverObjectURL;
  coverStatus.textContent = "Uploading original image to private Lasu storage…";

  try {
    const body = new FormData();
    body.append("image", file, file.name);

    const response = await fetch(`${API}/assets/cover`, {
      method: "POST",
      headers: {"Authorization": `Bearer ${token}`},
      body,
      signal: controller.signal,
    });

    const result = await response.json();
    if (version !== coverSelectionVersion) return;

    if (!response.ok) {
      throw new Error(typeof result.detail === "string"
        ? result.detail : `Cover upload failed (HTTP ${response.status}).`);
    }

    if (!/^images\/covers\/cover_uploads\/[0-9a-f]{64}\.(png|jpg|webp|heic|heif)$/.test(result.path)) {
      throw new Error("Invalid cover upload receipt.");
    }

    if (result.size_bytes !== file.size) {
      throw new Error("Uploaded image size does not match the selected file.");
    }

    coverAsset = result;
    coverStatus.textContent =
      `${file.name} · ${result.width} × ${result.height} · Original uploaded`;
    invalidateReview();
  } catch (error) {
    if (version !== coverSelectionVersion) return;
    coverAsset = null;
    coverStatus.textContent = error.message;
  } finally {
    if (version === coverSelectionVersion) coverUploadController = null;
  }
});


function previewManifest() {
  const selectedBatches = selectedAudioBatches();
  const tracks = selectedBatches.flatMap((batch) => batch.tracks);
  if (!tracks.length) throw new Error("Select at least one audio track.");
  const coverMode = visualSourceMode.value === "cover";
  if (coverMode) {
    if (coverUploadController) throw new Error("Cover upload is still in progress.");
    if (!coverAsset) throw new Error("Upload one cover image first.");
  } else {
    if (!selectedGifPaths.length) throw new Error("Select at least one GIF.");
    if (selectedGifPaths.some((path) =>
      !visualAssets.some((asset) => asset.kind === "gif" && asset.path === path)
    )) throw new Error("The GIF selection no longer matches this project.");
  }
  const internalFade = Number($("#internal-fade").value);
  const groupFade = Number($("#group-fade").value);
  if (![internalFade, groupFade].every((value) => Number.isFinite(value) && value > 0 && value <= 10)) {
    throw new Error("Crossfade durations must be greater than 0 and at most 10 seconds.");
  }
  if (!chosenPlaylist()) throw new Error("Choose a verified YouTube playlist.");
  if (youtubeChannel.value !== DEFAULT_CHANNEL) {
    throw new Error("Asopo zala is verified, but cloud publishing authorization is not connected yet.");
  }
  const title = $("#video-title").value.trim();
  if (!title || title.length > 100) throw new Error("Enter a YouTube title (up to 100 characters).");

  return {
    schema_version: 3,
    audio: {
      bucket: "mushroom-house-studio-audio-staging",
      theme: batches.find((batch) => themeKey(batch) === batchSelect.value)?.theme || null,
      batches: selectedBatches,
      refinements: Object.fromEntries(
        jazzPreset.value
          ? selectedBatches.flatMap(batch => batch.tracks.flatMap(track =>
              track.recordings.map(path => [path, jazzPreset.value])
            ))
          : []
      ),
    },
    visual: coverMode ? {
      bucket: "mushroom-house-visual-assets",
      project: "cover_uploads",
      kind: "cover",
      cover_path: coverAsset.path,
      gif_paths: [],
      playback: "still_full_audio",
      timeline: null,
    } : {
      bucket: "mushroom-house-visual-assets",
      project: projectSelect.value,
      kind: "gif",
      gif_paths: [...selectedGifPaths],
      playback: "loop_per_track",
      timeline: visualCompositionDraft ? structuredClone(visualCompositionDraft) : null,
    },
    composition: {
      trim_boundaries: $("#trim-boundaries").checked,
      internal_crossfade_seconds: internalFade,
      group_crossfade_seconds: groupFade,
    },
    publication: {
      channel: youtubeCatalog?.channels.find((item) => item.id === youtubeChannel.value)?.title || "",
      channel_id: youtubeChannel.value,
      playlist: chosenPlaylist()?.title || "",
      playlist_id: youtubePlaylist.value,
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
  if (youtubeChannel.value === DEFAULT_CHANNEL) refreshPlaylistChoices();
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

reviewButton.addEventListener("click", async () => {
  if (submissionInProgress || submissionUnconfirmed) return;
  if (activeProductionID) {
    await monitorProduction();
    return;
  }

  let manifest;
  try {
    manifest = previewManifest();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  submissionInProgress = true;
  submissionUnconfirmed = true;
  localStorage.setItem("lasu-submission-unconfirmed", "true");
  reviewButton.disabled = true;
  taskPanel.open = true;
  lastPublishError = "";
  updateTaskReport("Starting automation", "Saving production and starting cloud publishing.");

  try {
    const response = await fetch(`${API}/publishing/automated-productions`, {
      method: "POST",
      headers: {...headers(), "Content-Type": "application/json"},
      body: JSON.stringify({manifest, approve_youtube_publish: true})
    });

    const result = await response.json();

    if (!response.ok) {
      if ([400, 401, 403, 422].includes(response.status)) {
        submissionUnconfirmed = false;
        localStorage.removeItem("lasu-submission-unconfirmed");
      }
      throw new Error(typeof result.detail === "string" ? result.detail : `Cloud request failed: ${response.status}`);
    }
    if (!/^[0-9a-f]{32}$/.test(result.submission_id)) {
      throw new Error("Production submission could not be confirmed.");
    }

    activeProductionID = result.submission_id;
    localStorage.setItem("lasu-active-automation", activeProductionID);
    submissionUnconfirmed = false;
    localStorage.removeItem("lasu-submission-unconfirmed");
    await monitorProduction();
  } catch (error) {
    reportSubmissionError(error, "Starting automation", null, null);
    setStatus(error.message + " — Verify cloud status before submitting again.");
  } finally {
    submissionInProgress = false;
    reviewButton.disabled = Boolean(activeProductionID) || submissionUnconfirmed || !selectedAudioBatches().length;
  }
});



async function initialize() {
  if (!token) {
    $("#publish-auth").textContent = "Pair this device in Animation Studio to access private cloud assets.";
    setStatus("Device pairing required.");
    return;
  }
  try {
    await Promise.all([loadAudio(), loadProjects(), loadYoutubeDestinations()]);
    refreshPublicationDescription();
    $("#publish-auth").textContent = "Private cloud access enabled.";
    if (activeProductionID) {
      await monitorProduction();
    } else if (submissionUnconfirmed) {
      reviewButton.disabled = true;
      setStatus("Previous submission outcome is unconfirmed. Do not submit a duplicate.");
    } else {
      setStatus("Choose audio, visual and publication settings, then click Publish to YouTube.");
    }
  } catch (error) {
    $("#publish-auth").textContent = error.message;
    setStatus("Could not load private cloud assets.");
    reviewButton.disabled = true;
  }
}
initialize();

// Compose shares the existing Publishing Studio asset selection and order.
composerButton.addEventListener("click", () => {
  if (!selectedGifPaths.length || !projectSelect.value) return;
  composerStage.hidden = false;
  composerStatus.textContent = "Loading ordered GCP assets into Compose…";
  composerFrame.src = "./compose/";
});
$("#close-visual-composer").addEventListener("click", () => {
  composerStage.hidden = true;
  composerFrame.removeAttribute("src");
});
window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== composerFrame.contentWindow) return;
  const message = event.data;
  if (message?.type === "lasu:compose:ready" && !composerStage.hidden) {
    composerFrame.contentWindow.postMessage(
      { type: "lasu:compose:load", selection: currentComposeSelection() }, location.origin);
  } else if (message?.type === "lasu:compose:loaded") {
    composerStatus.textContent =
      `Compose loaded ${message.count} GIFs in the selected publishing order.`;
  } else if (message?.type === "lasu:compose:error") {
    composerStatus.textContent = message.error || "Compose could not load these assets.";
  } else if (message?.type === "lasu:compose:draft") {
    const draft = message.draft;
    if (draft?.project !== projectSelect.value ||
        JSON.stringify(draft.source_paths) !== JSON.stringify(selectedGifPaths)) {
      composerStatus.textContent = "Selection changed; draft rejected.";
      return;
    }
    visualCompositionDraft = structuredClone(draft);
    invalidateReview();
    composerStatus.textContent =
      `Draft received (${draft.clips.length} clips). This is a browser-side refinement; ` +
      "The timeline will be applied during reviewed cloud rendering.";
  }
});

// Apply one selected Mood Lab rule to the current composition.
const jazzPreset = $("#jazz-refiner-preset");
jazzPreset.addEventListener("change", invalidateReview);









async function monitorProduction() {
  if (!/^[0-9a-f]{32}$/.test(activeProductionID) || automationStatusBusy) return;
  clearTimeout(automationTimer);
  automationStatusBusy = true;
  reviewButton.disabled = true;
  taskPanel.open = true;

  try {
    const response = await fetch(`${API}/publishing/productions/${activeProductionID}/status`, {
      headers: headers()
    });
    if (!response.ok) throw new Error(`Cloud status unavailable: ${response.status}`);
    const data = await response.json();

    if (data.completed) {
      updateTaskReport("Completed", `YouTube publication verified. Temporary video cleaned up. Production: ${activeProductionID}`);
      setStatus(`Published: ${data.youtube_url}`);
      const link = document.createElement("a");
      link.href = data.youtube_url;
      link.textContent = "Watch published video on YouTube";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      $("#publish-status").append(document.createTextNode(" "), link);

      localStorage.removeItem("lasu-active-automation");
      activeProductionID = "";
      reviewButton.disabled = !selectedAudioBatches().length;
      return;
    }

    const progress = data.progress || {};
    const stages = {
      not_started: ["Not started", "Cloud execution has not started."],
      queued: ["Queued", "Production accepted. Waiting for the cloud worker."],
      preparing: ["Preparing", "Loading the reviewed audio and visual sources."],
      refining_audio: ["Refining audio", "Applying the selected audio refinement rule."],
      composing_audio: ["Composing audio", "Joining the selected recordings and creating chapters."],
      rendering: ["Rendering", "Rendering the reviewed video timeline."],
      staging_video: ["Saving render", "Saving the rendered video and composition metadata."],
      render_ready: ["Render ready", "The reviewed render is ready for publication."],
      preparing_publication: ["Preparing publication", "Checking the rendered video and YouTube destination."],
      uploading: ["Uploading", "Uploading the rendered video to YouTube."],
      verifying: ["Verifying YouTube", "Checking video processing and playlist placement."],
      cleanup: ["Cleanup", "Publication verified. Removing temporary rendered media."],
      running: ["Running", "Cloud execution confirmed. Detailed progress is not available."],
      failed: ["Attention required", "Cloud production reported a failure. Do not submit a duplicate."],
      status_unavailable: ["Awaiting confirmation", "No current worker checkpoint is available. Monitoring will continue."]
    };

    // Retain compatibility with the previous API during deployment.
    let stage = progress.stage;
    if (!stage) {
      if ([data.render, data.publish, data.automation].includes("failed") ||
          [data.render, data.publish, data.automation].includes("dispatch_rejected")) {
        stage = "failed";
      } else if (data.youtube_status === "published_verified") {
        stage = "cleanup";
      } else if (data.video_id) {
        stage = "verifying";
      } else if (data.youtube_status === "upload_started") {
        stage = "uploading";
      } else if (data.render_ready) {
        stage = "preparing_publication";
      } else if ([data.render, data.publish, data.automation].includes("running")) {
        stage = "running";
      } else {
        stage = "status_unavailable";
      }
    }

    const [label, description] = stages[stage] || stages.status_unavailable;
    const percent = stage === "uploading" &&
      typeof progress.percent === "number" &&
      Number.isFinite(progress.percent) &&
      progress.percent >= 0 && progress.percent <= 100
        ? progress.percent
        : null;

    let detail = description;
    if (progress.updated_at) {
      const updated = new Date(progress.updated_at);
      if (!Number.isNaN(updated.getTime())) {
        detail += ` Last worker checkpoint: ${updated.toLocaleTimeString()}.`;
      }
    }

    detail += ` Production: ${activeProductionID}.`;
    updateTaskReport(label, detail, percent);

    if (stage === "failed") {
      setStatus("Production requires attention. Existing production ID retained for recovery.");
    } else {
      setStatus(label + (percent === null ? "" : ` · ${percent.toFixed(1)}%`));
    }

    automationTimer = setTimeout(monitorProduction, 15000);
  } catch (error) {
    setStatus(error.message + " — Status monitoring will retry automatically.");
    automationTimer = setTimeout(monitorProduction, 30000);
  } finally {
    automationStatusBusy = false;
  }
}


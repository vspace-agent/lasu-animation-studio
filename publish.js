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
let submissionInProgress = false;

function invalidateReview() {
  reviewedManifestJSON = null;
  submitButton.disabled = true;
  $("#manifest-preview").textContent = "";
}

const reviewInputIds = new Set([
  "audio-batch", "visual-project", "publishing-preset",
  "trim-boundaries", "internal-fade", "group-fade", "jazz-refiner-preset", "jazz-refiner-recording",
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
  const chosen = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const keys = new Set(chosen.map((input) => `${input.dataset.batchId}/${input.dataset.trackName}`));
  const selectedRuns = batches.filter((batch) => themeKey(batch) === batchSelect.value)
    .map((batch) => ({
      ...batch,
      tracks: batch.tracks.filter((track) => keys.has(`${batch.id}/${track.name}`)),
    })).filter((batch) => batch.tracks.length);
  if (!selectedRuns.length) return "";

  const story = selectedRuns.map((batch) => batch.story?.trim()).find(Boolean);
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
  const chosen = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const keys = new Set(chosen.map((input) => `${input.dataset.batchId}/${input.dataset.trackName}`));
  const runs = batches.filter((batch) => themeKey(batch) === batchSelect.value)
    .filter((batch) => batch.tracks.some((track) =>
      keys.has(`${batch.id}/${track.name}`)));
  const missing = [];
  if (runs.length && !runs.some((batch) => batch.story?.trim())) {
    missing.push("Original batch story unavailable from the audio API.");
  }
  if ($("#publishing-preset").value !== "sft_lm_review" &&
      runs.length && !runs.some((batch) => batch.tracks.some((track) =>
      keys.has(`${batch.id}/${track.name}`) && batch.music_prompts?.[track.name]?.trim()))) {
    missing.push("Original music prompts unavailable from the audio API.");
  }
  return missing;
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

function renderAudio() {
  LasuAudioReview.reset();
  invalidateReview();
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

  const sftReview = $("#publishing-preset").value === "sft_lm_review";
  if (sftReview) {
    LasuAudioReview.makeToolbar(
      audioContainer, API, token,
      () => {
        for (const input of audioContainer.querySelectorAll(".audio-track-selection")) {
          if (input.dataset.batchId !== undefined) {
            const corresponding = [...audioContainer.querySelectorAll(".sft-recording-selection")]
              .filter((take) =>
                take.dataset.batchId === input.dataset.batchId &&
                take.dataset.trackName === input.dataset.trackName
              );
            if (corresponding.length) input.checked = corresponding.some((take) => take.checked);
          }
        }
        invalidateReview();
        refreshPublicationDescription();
      },
      setStatus
    );
  }

  const routes = ["turbo", "sft_lm", ...new Set(matching.map((batch) => batch.route))];
  for (const route of [...new Set(routes)]) {
    const runs = matching.filter((batch) => batch.route === route);
    if (!runs.length || (sftReview && route !== "sft_lm")) continue;
    const group = document.createElement("details");
    group.className = "publish-model-group";
    group.open = sftReview;
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
        for (const entry of group.querySelectorAll(".sft-recording-selection")) {
          entry.checked = checked;
        }
        if (!sftReview) $("#publishing-preset").value = "manual";
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
      run.open = sftReview;
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
        check.checked = sftReview
          ? batch.route === "sft_lm" && track.name !== "track_01_batch_story"
          : $("#publishing-preset").value === "turbo_long_listen"
            ? batch.route === "turbo" && track.name !== "track_01_batch_story"
            : false;
        const description = document.createElement("span");
        description.textContent = `${track.name.replace(/^track_\\d+_/, "").replaceAll("_", " ")} · ${track.recordings.length} recording(s)`;
        label.append(check, description);
        check.addEventListener("change", () => {
          if (!sftReview) $("#publishing-preset").value = "manual";
          $("#manifest-preview").textContent = "";
          refreshPublicationDescription();
        });
        run.append(label);
        if (sftReview && batch.route === "sft_lm" && !/^track_01_/.test(track.name)) {
          const recordings = document.createElement("div");
          recordings.className = "sft-recordings";
          for (const recording of track.recordings) {
            LasuAudioReview.addRecording(recordings, batch, track, recording);
          }
          run.append(recordings);
          check.addEventListener("change", () => {
            for (const entry of recordings.querySelectorAll(".sft-recording-selection")) {
              entry.checked = check.checked;
            }
          });
        }
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

function previewManifest() {
  if ($("#publishing-preset").value === "sft_lm_review") {
    const cuts = LasuAudioReview.selections();
    if (cuts.some((cut) => cut.start_seconds !== 0 || cut.end_seconds !== null)) {
      throw new Error("Trim previews are ready; saving trim settings requires the SFT+LM composition backend.");
    }
  }
  const selected = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const sftMode = $("#publishing-preset").value === "sft_lm_review";
  const takePaths = sftMode
    ? new Set(LasuAudioReview.selections().map((entry) => entry.path))
    : null;
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
          recordings: sftMode
            ? track.recordings.filter((recording) => takePaths.has(recording.path))
                .map((recording) => recording.path)
            : track.recordings.map((recording) => recording.path),
        }))
        .filter((track) => track.recordings.length > 0),
    }))
    .filter((batch) => batch.tracks.length && (!sftMode || batch.route === "sft_lm"));
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
        [...jazzRefinements.entries()].filter(([path]) =>
          selectedBatches.some(batch => batch.tracks.some(track => track.recordings.includes(path)))
        )
      ),
    },
    visual: {
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
reviewButton.addEventListener("click", () => {
  if (submissionInProgress) return;
  invalidateReview();
  try {
    reviewedManifestJSON = JSON.stringify(previewManifest());
    $("#manifest-preview").textContent = JSON.stringify(
      JSON.parse(reviewedManifestJSON), null, 2
    );
    submitButton.disabled = false;
    setStatus("Manifest reviewed. Save to cloud only if every selection and publication field is correct.");
  } catch (error) {
    setStatus(error.message);
  }
});

submitButton.addEventListener("click", async () => {
  if (submissionInProgress) return;
  if (!reviewedManifestJSON) {
    setStatus("Review the production manifest before submitting.");
    return;
  }

  const snapshot = reviewedManifestJSON;
  try {
    if (JSON.stringify(previewManifest()) !== snapshot) {
      throw new Error("Production settings changed after review. Review again before saving.");
    }
  } catch (error) {
    invalidateReview();
    setStatus(error.message);
    return;
  }

  submissionInProgress = true;
  submitButton.disabled = true;
  reviewButton.disabled = true;
  setStatus("Saving reviewed production to private cloud storage…");
  lastPublishError = "";
  taskPanel.open = true;
  let phase = "Uploading request";
  updateTaskReport(phase, "Sending the reviewed manifest to Lasu Cloud.");

  try {
    const saved = await submitReviewedManifest(
      snapshot,
      (percent) => {
        if (phase === "Uploading request") {
          updateTaskReport(phase, "Sending the reviewed manifest to Lasu Cloud.", percent);
        }
      },
      (stage, message) => {
        phase = stage;
        updateTaskReport(stage, message);
      }
    );
    if (!/^[0-9a-f]{32}$/.test(saved.submission_id) ||
        saved.status !== "reviewed_not_started") {
      throw new Error("Unexpected production submission response.");
    }
    if (reviewedManifestJSON === snapshot) invalidateReview();
    updateTaskReport("Finished", `Saved to cloud · ID: ${saved.submission_id}. Rendering not started.`);
    setStatus(`Production saved to cloud · ID: ${saved.submission_id} · Rendering not started.`);
  } catch (error) {
    reportSubmissionError(error, phase, error.httpStatus ?? null, error.serverDetail ?? null);
    setStatus(error.message);
    if (reviewedManifestJSON === snapshot) submitButton.disabled = false;
  } finally {
    submissionInProgress = false;
    reviewButton.disabled = !audioContainer.querySelector(".audio-track-selection");
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
    setStatus("Choose the recordings and visual, then review the production manifest.");
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
      "cloud manifest v2 does not yet support custom timeline rendering.";
  }
});

// Jazz Refiner is part of the existing audio collection, not a second importer.
const jazzRefinements = new Map();
const jazzRecording = $("#jazz-refiner-recording");
const jazzPreset = $("#jazz-refiner-preset");
const jazzPreview = $("#jazz-refiner-preview");
const jazzPlayer = $("#jazz-refiner-player");
const jazzStatus = $("#jazz-refiner-status");
let jazzPreviewURL = null;
let jazzPreviewController = null;

function selectedJazzRecordingPaths() {
  const checked = [...audioContainer.querySelectorAll(".audio-track-selection:checked")];
  const sft = $("#publishing-preset").value === "sft_lm_review";
  const included = new Set(checked.map(input =>
    `${input.dataset.batchId}/${input.dataset.trackName}`));
  const selectedTakes = sft
    ? new Set([...audioContainer.querySelectorAll(".sft-recording-selection:checked")]
        .map(input => input.dataset.path))
    : null;
  return batches.filter(batch => themeKey(batch) === batchSelect.value)
    .filter(batch => !sft || batch.route === "sft_lm")
    .flatMap(batch => batch.tracks
      .filter(track => included.has(`${batch.id}/${track.name}`))
      .flatMap(track => track.recordings.map(recording => recording.path)
        .filter(path => !selectedTakes || selectedTakes.has(path))));
}

function stopJazzPreview() {
  jazzPreviewController?.abort();
  jazzPreviewController = null;
  jazzPlayer.pause();
  jazzPlayer.removeAttribute("src");
  jazzPlayer.load();
  if (jazzPreviewURL) URL.revokeObjectURL(jazzPreviewURL);
  jazzPreviewURL = null;
}

function refreshJazzRefiner() {
  const previous = jazzRecording.value;
  const paths = [...new Set(selectedJazzRecordingPaths())];
  jazzRecording.replaceChildren(new Option("Choose selected recording…", ""));
  for (const path of paths) jazzRecording.add(new Option(path.split("/").pop(), path));
  if (paths.includes(previous)) jazzRecording.value = previous;
  jazzPreset.value = jazzRefinements.get(jazzRecording.value) || "";
  jazzPreview.disabled = !jazzRecording.value || !jazzPreset.value;
  if (!paths.length) jazzStatus.textContent = "Select a cloud music track first.";
}

jazzRecording.addEventListener("change", () => {
  stopJazzPreview();
  jazzPreset.value = jazzRefinements.get(jazzRecording.value) || "";
  jazzPreview.disabled = !jazzRecording.value || !jazzPreset.value;
});
jazzPreset.addEventListener("change", () => {
  stopJazzPreview();
  if (jazzRecording.value && selectedJazzRecordingPaths().includes(jazzRecording.value)) {
    if (jazzPreset.value) jazzRefinements.set(jazzRecording.value, jazzPreset.value);
    else jazzRefinements.delete(jazzRecording.value);
  }
  invalidateReview();
  jazzPreview.disabled = !jazzRecording.value || !jazzPreset.value;
  jazzStatus.textContent = jazzPreset.value
    ? "Refinement rule selected; preview before approving."
    : "Original recording selected; no refinement.";
});
jazzPreview.addEventListener("click", async () => {
  if (!selectedJazzRecordingPaths().includes(jazzRecording.value) ||
      !["warm_evening", "soft_velvet", "small_room", "midnight_mist"].includes(jazzPreset.value)) {
    jazzStatus.textContent = "Choose a currently selected recording and jazz preset.";
    return;
  }
  stopJazzPreview();
  const controller = new AbortController();
  jazzPreviewController = controller;
  jazzPreview.disabled = true;
  jazzStatus.textContent = "Rendering temporary 30-second preview…";
  try {
    const response = await fetch(
      `${API}/audio/refiner/preview?${new URLSearchParams({
        path: jazzRecording.value, preset: jazzPreset.value
      })}`, { headers: headers(), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Jazz preview HTTP ${response.status}`);
    const blob = await response.blob();
    if (controller.signal.aborted) return;
    jazzPreviewURL = URL.createObjectURL(blob);
    jazzPlayer.src = jazzPreviewURL;
    jazzStatus.textContent = "Preview ready. Original cloud recording is unchanged.";
    await jazzPlayer.play().catch(() => {});
  } catch (error) {
    if (error.name !== "AbortError")
      jazzStatus.textContent = `Refinement unavailable: ${error.message}`;
  } finally {
    if (jazzPreviewController === controller) {
      jazzPreviewController = null;
      jazzPreview.disabled = !jazzRecording.value || !jazzPreset.value;
    }
  }
});

audioContainer.addEventListener("change", () => {
  stopJazzPreview();
  refreshJazzRefiner();
});
const jazzObserve = new MutationObserver(() => {
  if (!audioContainer.querySelector(".audio-track-selection")) return;
  refreshJazzRefiner();
});
jazzObserve.observe(audioContainer, { childList: true, subtree: false });
window.addEventListener("pagehide", stopJazzPreview);

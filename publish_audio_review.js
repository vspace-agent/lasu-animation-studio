// Review SFT+LM recordings with per-take selection, sequential listening, and non-destructive trim preview.
"use strict";

window.LasuAudioReview = (() => {
  let rows = [];
  let player = null;
  let activeUrl = null;
  let queue = [];
  let sequence = 0;
  let fetchController = null;
  let onSelectionChange = () => {};
  let onMessage = () => {};
  let apiBase = "";
  let deviceToken = "";

  function disposePlayback() {
    sequence += 1;
    queue = [];
    if (fetchController) fetchController.abort();
    fetchController = null;
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    activeUrl = null;
  }

  function reset() {
    disposePlayback();
    rows = [];
    if (player) player.remove();
    player = null;
  }

  function makeToolbar(container, api, token, changed, report) {
    apiBase = api;
    deviceToken = token;
    onSelectionChange = changed;
    onMessage = report;
    const bar = document.createElement("div");
    bar.className = "sft-review-toolbar";
    const play = document.createElement("button");
    play.type = "button";
    play.textContent = "▶ Play all selected";
    play.addEventListener("click", () => startQueue(rows.filter((row) => row.check.checked)));
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "■ Stop";
    stop.addEventListener("click", () => {
      disposePlayback();
      onMessage("Playback stopped.");
    });
    player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.setAttribute("aria-label", "SFT+LM recording preview");
    bar.append(play, stop, player);
    container.append(bar);
  }

  function addRecording(parent, batch, track, recording) {
    const row = document.createElement("div");
    row.className = "sft-recording";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "sft-recording-selection";
    check.checked = true;
    check.dataset.batchId = batch.id;
    check.dataset.trackName = track.name;
    check.dataset.path = recording.path;

    const label = document.createElement("span");
    const filename = recording.path.split("/").pop();
    label.className = "sft-recording-name";
    label.textContent = filename;

    const start = document.createElement("input");
    start.type = "number";
    start.min = "0";
    start.step = "0.1";
    start.value = "0";
    start.setAttribute("aria-label", `Trim start seconds for ${filename}`);

    const end = document.createElement("input");
    end.type = "number";
    end.min = "0";
    end.step = "0.1";
    end.placeholder = "End";
    end.setAttribute("aria-label", `Trim end seconds for ${filename}`);

    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = "▶ Preview";
    const entry = { check, start, end, preview, path: recording.path };
    rows.push(entry);

    preview.addEventListener("click", () => startQueue([entry]));
    for (const input of [check, start, end]) {
      input.addEventListener("change", onSelectionChange);
    }

    const startLabel = document.createElement("label");
    startLabel.textContent = "From (s)";
    startLabel.append(start);
    const endLabel = document.createElement("label");
    endLabel.textContent = "To (s)";
    endLabel.append(end);
    row.append(check, label, startLabel, endLabel, preview);
    parent.append(row);
  }

  function trimBounds(entry, duration) {
    const start = Number(entry.start.value || 0);
    const end = entry.end.value === "" ? duration : Number(entry.end.value);
    if (!Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end <= start || end > duration + 0.1) {
      throw new Error("Invalid trim range. Set a start before the end of the recording.");
    }
    return { start, end: Math.min(end, duration) };
  }

  async function startQueue(items) {
    disposePlayback();
    const current = sequence;
    queue = [...items];
    if (!queue.length) {
      onMessage("No recordings selected for playback.");
      return;
    }
    await playNext(current);
  }

  async function playNext(current) {
    if (current !== sequence || !queue.length || !player) return;
    const entry = queue.shift();
    fetchController = new AbortController();
    onMessage(`Loading recording ${rows.indexOf(entry) + 1} of ${rows.length}…`);
    try {
      const response = await fetch(
        `${apiBase}/audio/preview?${new URLSearchParams({ path: entry.path })}`,
        {
          headers: { Authorization: `Bearer ${deviceToken}` },
          signal: fetchController.signal,
        }
      );
      if (!response.ok) throw new Error(`Audio preview failed (HTTP ${response.status}).`);
      const blob = await response.blob();
      if (current !== sequence) return;
      const nextUrl = URL.createObjectURL(blob);
      player.pause();
      player.removeAttribute("src");
      player.load();
      if (activeUrl) URL.revokeObjectURL(activeUrl);
      activeUrl = nextUrl;
      player.src = nextUrl;
      await new Promise((resolve, reject) => {
        player.addEventListener("loadedmetadata", resolve, { once: true });
        player.addEventListener("error", () => reject(new Error("Browser cannot decode this FLAC recording.")), { once: true });
        player.load();
      });
      if (current !== sequence) return;
      const bounds = trimBounds(entry, player.duration);
      entry.start.max = String(player.duration);
      entry.end.max = String(player.duration);
      player.currentTime = bounds.start;
      onMessage(`Playing recording ${rows.indexOf(entry) + 1} of ${rows.length}.`);
      player.ontimeupdate = () => {
        if (current !== sequence) return;
        if (player.currentTime >= bounds.end - 0.03) {
          player.pause();
          player.ontimeupdate = null;
          void playNext(current);
        }
      };
      player.onended = () => {
        if (current !== sequence) return;
        player.ontimeupdate = null;
        void playNext(current);
      };
      await player.play();
    } catch (error) {
      if (current === sequence && error.name !== "AbortError") {
        onMessage(error.message);
      }
    }
  }

  function selections() {
    return rows.filter((entry) => entry.check.checked).map((entry) => ({
      path: entry.path,
      start_seconds: Number(entry.start.value || 0),
      end_seconds: entry.end.value === "" ? null : Number(entry.end.value),
    }));
  }

  return { reset, makeToolbar, addRecording, selections };
})();

// Review SFT+LM recordings with waveform trimming, active-take highlighting, and sequential playback.
"use strict";

window.LasuAudioReview = (() => {
  let rows = [];
  let player = null;
  let activeUrl = null;
  let queue = [];
  let sequence = 0;
  let fetchController = null;
  let activeEntry = null;
  let observer = null;
  let audioContext = null;
  let onSelectionChange = () => {};
  let onMessage = () => {};
  let apiBase = "";
  let deviceToken = "";

  function setActive(entry) {
    for (const row of rows) {
      row.element.classList.toggle("sft-recording-playing", row === entry);
      row.element.setAttribute("aria-current", row === entry ? "true" : "false");
      row.state.textContent = row === entry ? "▶ Playing" : "";
    }
    activeEntry = entry;
  }

  function disposePlayback() {
    sequence += 1;
    queue = [];
    if (fetchController) fetchController.abort();
    fetchController = null;
    if (player) {
      player.pause();
      player.ontimeupdate = null;
      player.onended = null;
      player.removeAttribute("src");
      player.load();
    }
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    activeUrl = null;
    setActive(null);
  }

  function reset() {
    disposePlayback();
    if (observer) observer.disconnect();
    observer = null;
    for (const entry of rows) {
      if (entry.waveController) entry.waveController.abort();
    }
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
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((items) => {
        for (const item of items) {
          if (item.isIntersecting) {
            observer.unobserve(item.target);
            const entry = rows.find((row) => row.element === item.target);
            if (entry) void loadWaveform(entry);
          }
        }
      }, { rootMargin: "250px 0px" });
    }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "--:--";
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1).padStart(4, "0");
    return `${minutes}:${secs}`;
  }

  function bounds(entry) {
    const duration = entry.duration;
    if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
    const start = Math.max(0, Math.min(duration, Number(entry.start.value || 0)));
    const end = entry.end.value === "" ? duration : Math.max(start, Math.min(duration, Number(entry.end.value)));
    return { start, end };
  }

  function updateWaveform(entry) {
    const canvas = entry.canvas;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
    const height = Math.max(1, Math.round(rect.height * (window.devicePixelRatio || 1)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#e8efed";
    ctx.fillRect(0, 0, width, height);
    const peaks = entry.peaks;
    if (peaks) {
      const count = peaks.length;
      const half = height / 2;
      ctx.fillStyle = "#678b85";
      for (let x = 0; x < width; x += 2) {
        const peak = peaks[Math.min(count - 1, Math.floor(x / width * count))];
        const bar = Math.max(1, peak * (half - 3));
        ctx.fillRect(x, half - bar, Math.max(1, width / count), bar * 2);
      }
    } else {
      ctx.fillStyle = "#718981";
      ctx.font = `${Math.max(12, Math.round(height * 0.24))}px sans-serif`;
      ctx.fillText(entry.waveError || "Loading waveform…", 10, height / 2 + 4);
    }
    if (entry.duration) {
      const { start, end } = bounds(entry);
      const left = start / entry.duration * width;
      const right = end / entry.duration * width;
      ctx.fillStyle = "rgba(237, 242, 239, 0.78)";
      ctx.fillRect(0, 0, left, height);
      ctx.fillRect(right, 0, width - right, height);
      ctx.strokeStyle = "#245f51";
      ctx.lineWidth = Math.max(2, width / rect.width * 2);
      for (const x of [left, right]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = "#245f51";
        ctx.fillRect(Math.max(0, x - 5), height / 2 - 10, 10, 20);
      }
      entry.trimInfo.textContent = `${formatTime(start)} – ${formatTime(end)} / ${formatTime(entry.duration)}`;
    } else {
      entry.trimInfo.textContent = "Waveform loading";
    }
  }

  function setTrim(entry, side, seconds) {
    if (!entry.duration) return;
    const current = bounds(entry);
    const minimum = Math.min(0.1, entry.duration / 2);
    const value = Math.max(0, Math.min(entry.duration, seconds));
    if (side === "start") {
      entry.start.value = String(Math.min(value, current.end - minimum));
    } else {
      const selected = Math.max(value, current.start + minimum);
      entry.end.value = selected >= entry.duration - 0.05 ? "" : String(selected);
    }
    updateWaveform(entry);
    onSelectionChange();
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

    const state = document.createElement("strong");
    state.className = "sft-recording-state";
    state.setAttribute("aria-live", "polite");

    const canvas = document.createElement("canvas");
    canvas.className = "sft-waveform";
    canvas.setAttribute("role", "slider");
    canvas.setAttribute("aria-label", `Trim ${filename} by dragging the waveform handles`);
    canvas.setAttribute("aria-valuetext", "Full recording");
    canvas.tabIndex = 0;
    const trimInfo = document.createElement("span");
    trimInfo.className = "sft-trim-info";
    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = "▶ Preview";

    const entry = {
      element: row, check, state, canvas, trimInfo, preview,
      start: { value: "0" }, end: { value: "" },
      path: recording.path, duration: null, peaks: null,
      waveController: null, waveError: null
    };
    rows.push(entry);
    preview.addEventListener("click", () => startQueue([entry]));
    check.addEventListener("change", onSelectionChange);

    let dragging = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (!entry.duration) return;
      const rect = canvas.getBoundingClientRect();
      const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const current = bounds(entry);
      const seconds = position * entry.duration;
      dragging = Math.abs(seconds - current.start) <= Math.abs(seconds - current.end) ? "start" : "end";
      canvas.setPointerCapture(event.pointerId);
      setTrim(entry, dragging, seconds);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging || !entry.duration) return;
      const rect = canvas.getBoundingClientRect();
      setTrim(entry, dragging, (event.clientX - rect.left) / rect.width * entry.duration);
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(name, () => { dragging = null; });
    }
    canvas.addEventListener("keydown", (event) => {
      if (!entry.duration || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const side = event.shiftKey ? "end" : "start";
      const current = bounds(entry);
      const delta = (event.key === "ArrowRight" ? 1 : -1) * 0.1;
      setTrim(entry, side, current[side] + delta);
    });
    row.append(check, label, state, canvas, trimInfo, preview);
    parent.append(row);
    updateWaveform(entry);
    if (observer) observer.observe(row);
    else void loadWaveform(entry);
  }

  async function loadWaveform(entry, providedBlob = null) {
    if (entry.peaks || entry.waveController || !rows.includes(entry)) return;
    const controller = new AbortController();
    entry.waveController = controller;
    try {
      let blob = providedBlob;
      if (!blob) {
        const response = await fetch(
          `${apiBase}/audio/preview?${new URLSearchParams({ path: entry.path })}`,
          { headers: { Authorization: `Bearer ${deviceToken}` }, signal: controller.signal }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        blob = await response.blob();
      }
      if (controller.signal.aborted) return;
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
      if (controller.signal.aborted || !rows.includes(entry)) return;
      entry.duration = buffer.duration;
      const data = buffer.getChannelData(0);
      const buckets = 320;
      const peaks = new Float32Array(buckets);
      for (let i = 0; i < buckets; i++) {
        const from = Math.floor(i * data.length / buckets);
        const to = Math.max(from + 1, Math.floor((i + 1) * data.length / buckets));
        let amplitude = 0;
        const stride = Math.max(1, Math.floor((to - from) / 128));
        for (let j = from; j < to; j += stride) amplitude = Math.max(amplitude, Math.abs(data[j]));
        peaks[i] = amplitude;
      }
      entry.peaks = peaks;
      updateWaveform(entry);
    } catch (error) {
      if (!controller.signal.aborted) {
        entry.waveError = `Waveform unavailable (${error.message})`;
        updateWaveform(entry);
      }
    } finally {
      if (entry.waveController === controller) entry.waveController = null;
    }
  }

  function trimBounds(entry, duration) {
    const start = Number(entry.start.value || 0);
    const end = entry.end.value === "" ? duration : Number(entry.end.value);
    if (!Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end <= start || end > duration + 0.1) {
      throw new Error("Invalid trim range. Move the waveform handles within the recording.");
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
    if (current !== sequence || !queue.length || !player) {
      if (current === sequence) setActive(null);
      return;
    }
    const entry = queue.shift();
    fetchController = new AbortController();
    setActive(entry);
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
      void loadWaveform(entry, blob);
      const nextUrl = URL.createObjectURL(blob);
      player.pause();
      player.ontimeupdate = null;
      player.onended = null;
      player.removeAttribute("src");
      player.load();
      if (activeUrl) URL.revokeObjectURL(activeUrl);
      activeUrl = nextUrl;
      player.src = nextUrl;
      await new Promise((resolve, reject) => {
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("Browser cannot decode this FLAC recording.")); };
        const cleanup = () => {
          player.removeEventListener("loadedmetadata", ready);
          player.removeEventListener("error", failed);
        };
        player.addEventListener("loadedmetadata", ready);
        player.addEventListener("error", failed);
        player.load();
      });
      if (current !== sequence) return;
      const range = trimBounds(entry, player.duration);
      if (!entry.duration) {
        entry.duration = player.duration;
        updateWaveform(entry);
      }
      player.currentTime = range.start;
      onMessage(`Playing recording ${rows.indexOf(entry) + 1} of ${rows.length}.`);
      let advancing = false;
      const advance = () => {
        if (advancing || current !== sequence) return;
        advancing = true;
        player.pause();
        player.ontimeupdate = null;
        player.onended = null;
        void playNext(current);
      };
      player.ontimeupdate = () => {
        if (player.currentTime >= range.end - 0.03) advance();
      };
      player.onended = advance;
      await player.play();
    } catch (error) {
      if (current === sequence && error.name !== "AbortError") {
        onMessage(error.message);
        setActive(null);
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

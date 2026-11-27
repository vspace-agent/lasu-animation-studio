(() => {

"use strict";

const BASE = "https://raw.githubusercontent.com/asopozala-prog/mushroom-lasu-visual-library/main/";
const categorySelect = document.querySelector("#gallery-category");
const projectSelect = document.querySelector("#gallery-project");
const grid = document.querySelector("#gallery-grid");
const status = document.querySelector("#gallery-status");
const more = document.querySelector("#gallery-more");
const PAGE_SIZE = 24;
const LABELS = {
  "animations/gifs": "GIF Animations",
  "animations/mp4": "MP4 Animations",
  "images/covers": "Cover Images",
  "images/sprite_sheets": "Sprite Sheets",
  "images/Lasu_images": "Lasu Images"
};

let assets = [];
let visible = [];
let rendered = 0;
let publishedAt = "";

function assetURL(asset) {
  return BASE + asset.path.split("/").map(encodeURIComponent).join("/");
}

function projectOf(asset) {
  const parts = asset.path.split("/");
  return parts.length > 3 ? parts[2] : "General";
}

function readable(value) {
  return value.replace(/_/g, " ");
}

function validAsset(asset) {
  if (!asset || typeof asset.path !== "string") return false;
  const parts = asset.path.split("/");
  return parts.length >= 3 &&
    ["images", "animations"].includes(parts[0]) &&
    parts.every(p => p && !p.startsWith(".") && !p.includes("\\")) &&
    asset.category === parts.slice(0, 2).join("/") &&
    asset.filename === parts[parts.length - 1] &&
    /\.(png|jpe?g|webp|gif|mp4|webm|avif)$/i.test(asset.path) &&
    Number.isSafeInteger(asset.bytes) && asset.bytes >= 0;
}

function options(select, values, allLabel, label) {
  const selected = select.value;
  select.replaceChildren(new Option(allLabel, ""));
  for (const value of [...new Set(values)].sort()) {
    select.add(new Option(label(value), value));
  }
  if ([...select.options].some(o => o.value === selected)) {
    select.value = selected;
  }
}

async function download(asset, button) {
  button.disabled = true;
  button.textContent = "Downloading…";
  try {
    const response = await fetch(assetURL(asset));
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = asset.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    button.textContent = "Download original";
  } catch {
    button.textContent = "Retry download";
  } finally {
    button.disabled = false;
  }
}

function card(asset) {
  const article = document.createElement("article");
  article.className = "public-gallery-card";
  const video = /\.(mp4|webm)$/i.test(asset.path);
  const media = document.createElement(video ? "video" : "img");
  if (video) {
    media.controls = true;
    media.preload = "none";
    media.playsInline = true;
  } else {
    media.loading = "lazy";
    media.decoding = "async";
    media.alt = (LABELS[asset.category] || readable(asset.category)) +
      " · " + readable(projectOf(asset));
  }
  media.src = assetURL(asset);

  const details = document.createElement("div");
  details.className = "public-gallery-details";
  const title = document.createElement("p");
  title.textContent = readable(projectOf(asset));
  const meta = document.createElement("small");
  meta.textContent = (LABELS[asset.category] || readable(asset.category)) +
    " · " + (asset.bytes / 1048576).toFixed(2) + " MB";
  const filename = document.createElement("small");
  filename.textContent = asset.filename.length > 28
    ? asset.filename.slice(0, 16) + "…" + asset.filename.split(".").pop()
    : asset.filename;
  filename.title = asset.filename;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Download original";
  button.addEventListener("click", () => download(asset, button));
  details.append(title, meta, filename, button);
  article.append(media, details);
  return article;
}

function renderNext() {
  const batch = visible.slice(rendered, rendered + PAGE_SIZE);
  const fragment = document.createDocumentFragment();
  for (const asset of batch) fragment.append(card(asset));
  grid.append(fragment);
  rendered += batch.length;
  more.hidden = rendered >= visible.length;
  status.textContent = `${rendered} of ${visible.length} assets` +
    (publishedAt ? ` · Updated ${publishedAt}` : "");
}

function filter() {
  visible = assets.filter(a =>
    (!categorySelect.value || a.category === categorySelect.value) &&
    (!projectSelect.value || projectOf(a) === projectSelect.value)
  );
  rendered = 0;
  grid.replaceChildren();
  renderNext();
}

categorySelect.addEventListener("change", () => {
  options(projectSelect, assets.filter(a =>
    !categorySelect.value || a.category === categorySelect.value
  ).map(projectOf), "All projects", readable);
  filter();
});
projectSelect.addEventListener("change", filter);
more.addEventListener("click", renderNext);

async function initialize() {
  try {
    const response = await fetch(BASE + "catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Catalog unavailable");
    const catalog = await response.json();
    if (catalog.schema_version !== 1 || !Array.isArray(catalog.assets)) {
      throw new Error("Invalid catalog");
    }
    assets = catalog.assets.filter(validAsset).sort((a, b) =>
      String(b.updated || "").localeCompare(String(a.updated || "")) ||
      a.path.localeCompare(b.path)
    );
    publishedAt = catalog.published_at
      ? new Date(catalog.published_at).toLocaleDateString() : "";
    options(categorySelect, assets.map(a => a.category), "All categories",
      c => LABELS[c] || readable(c));
    options(projectSelect, assets.map(projectOf), "All projects", readable);
    filter();
  } catch (error) {
    status.textContent = "Gallery unavailable. Please reload to try again.";
    console.error(error);
  }
}

initialize();

})();

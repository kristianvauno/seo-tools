(function () {
  const items = [];
  let activeId = null;
  let map;
  let marker;
  let reverseTimer = 0;
  let objectUrls = [];
  let apiReady = false;
  let geoKeywords = [];
  let pendingUserKeywords = [];
  let placeInfo = { city: "", state: "", country: "", area: "" };
  let businesses = [];
  let selectedBizId = null;
  const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8788" : "";
  const BIZ_LOCAL_KEY = "seo-tools-businesses";

  const els = {
    drop: document.getElementById("drop-zone"),
    input: document.getElementById("file-input"),
    folder: document.getElementById("folder-input"),
    thumbs: document.getElementById("thumbs"),
    count: document.getElementById("file-count"),
    stage: document.getElementById("preview-stage"),
    title: document.getElementById("preview-title"),
    status: document.getElementById("preview-status"),
    table: document.getElementById("exif-table"),
    strip: document.getElementById("btn-strip"),
    stripAll: document.getElementById("btn-strip-all"),
    geo: document.getElementById("btn-geo"),
    geoAll: document.getElementById("btn-geo-all"),
    download: document.getElementById("btn-download"),
    zip: document.getElementById("btn-zip"),
    remove: document.getElementById("btn-remove"),
    lat: document.getElementById("lat"),
    lng: document.getElementById("lng"),
    formatBtns: Array.from(document.querySelectorAll(".format-btn")),
    locate: document.getElementById("btn-locate"),
    copy: document.getElementById("btn-copy"),
    stripOthers: document.getElementById("strip-others"),
    apiBanner: document.getElementById("api-banner"),
    apiKey: document.getElementById("api-key-input"),
    saveKey: document.getElementById("btn-save-key"),
    tagList: document.getElementById("tag-list"),
    tagInput: document.getElementById("tag-input"),
    tagStatus: document.getElementById("tag-status"),
    retag: document.getElementById("btn-retag"),
    desc: document.getElementById("image-desc"),
    copyDesc: document.getElementById("btn-copy-desc"),
    bizName: document.getElementById("biz-name"),
    saveBiz: document.getElementById("btn-save-biz"),
    bizList: document.getElementById("biz-list"),
    bizCount: document.getElementById("biz-count"),
  };

  function uid() {
    return "img-" + Math.random().toString(36).slice(2, 10);
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.getElementById("toasts").appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function activeItem() {
    return items.find((item) => item.id === activeId) || null;
  }

  function revokeLater(url) {
    objectUrls.push(url);
  }

  function blobUrl(u8, mime) {
    const url = URL.createObjectURL(new Blob([u8], { type: mime || "image/jpeg" }));
    revokeLater(url);
    return url;
  }

  function bytesLabel(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function outName(item) {
    if (item.outName) return item.outName;
    const base = item.name.replace(/\.[^.]+$/, "");
    if (item.kind === "jpeg") return item.name;
    return base + ".jpg";
  }

  function badgeFor(item) {
    if (item.gps && item.cleaned) return { cls: "geo", text: "GPS" };
    if (item.gps) return { cls: "geo", text: "GPS" };
    if (item.cleaned) return { cls: "clean", text: "Clean" };
    return { cls: "raw", text: item.kind.toUpperCase() };
  }

  function refreshMeta(item) {
    if (item.kind === "jpeg") {
      const info = ImageMeta.readExif(item.current);
      item.fields = info.fields;
      item.gps = info.gps;
      item.orientation = info.orientation || 1;
      if ((!item.fileKeywords || !item.fileKeywords.length) && info.keywords && info.keywords.length) {
        item.fileKeywords = info.keywords.slice();
      }
      if (!(item.description || "").trim()) {
        item.description = info.description || (info.iptc && info.iptc.caption) || "";
      }
    } else {
      item.fields = [];
      item.gps = null;
      item.orientation = 1;
    }
  }

  function normalizeTag(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function currentKeywords(item) {
    const src = []
      .concat(geoKeywords)
      .concat(item ? item.aiKeywords || [] : [])
      .concat(item ? item.fileKeywords || [] : [])
      .concat(item ? item.userKeywords || [] : [])
      .concat(!item ? pendingUserKeywords : []);
    const removed = item ? item.removedKeywords || [] : [];
    return ImageMeta.uniqueKeywords(src.filter((tag) => removed.indexOf(tag.toLowerCase()) === -1));
  }

  function tagOrigin(item, tag) {
    const key = tag.toLowerCase();
    const inList = (list) => (list || []).some((t) => t.toLowerCase() === key);
    if (item && inList(item.userKeywords)) return "user";
    if (!item && inList(pendingUserKeywords)) return "user";
    if (item && inList(item.aiKeywords)) return "ai";
    if (inList(geoKeywords)) return "geo";
    return "file";
  }

  function renderTags() {
    const item = activeItem();
    const tags = currentKeywords(item);
    els.tagList.innerHTML = "";
    tags.forEach((tag) => {
      const origin = tagOrigin(item, tag);
      const chip = document.createElement("span");
      chip.className = "tag" + (origin === "user" ? " user" : "");
      chip.innerHTML = "<span></span><button type=\"button\" aria-label=\"Remove tag\">×</button>";
      chip.querySelector("span").textContent = tag;
      chip.querySelector("button").addEventListener("click", () => removeTag(tag));
      els.tagList.appendChild(chip);
    });
    syncTagStatus();
  }

  function addUserTag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    const item = activeItem();
    if (!item) {
      pendingUserKeywords = ImageMeta.uniqueKeywords(pendingUserKeywords.concat([tag]));
      renderTags();
      return;
    }
    item.removedKeywords = (item.removedKeywords || []).filter((k) => k !== tag.toLowerCase());
    if (!currentKeywords(item).some((k) => k.toLowerCase() === tag.toLowerCase())) {
      item.userKeywords = (item.userKeywords || []).concat([tag]);
    }
    renderTags();
  }

  function removeTag(raw) {
    const key = normalizeTag(raw).toLowerCase();
    const item = activeItem();
    if (!item) {
      pendingUserKeywords = pendingUserKeywords.filter((k) => k.toLowerCase() !== key);
      geoKeywords = geoKeywords.filter((k) => k.toLowerCase() !== key);
      renderTags();
      return;
    }
    item.userKeywords = (item.userKeywords || []).filter((k) => k.toLowerCase() !== key);
    item.aiKeywords = (item.aiKeywords || []).filter((k) => k.toLowerCase() !== key);
    item.fileKeywords = (item.fileKeywords || []).filter((k) => k.toLowerCase() !== key);
    if (geoKeywords.some((k) => k.toLowerCase() === key) && (item.removedKeywords || []).indexOf(key) === -1) {
      item.removedKeywords = (item.removedKeywords || []).concat([key]);
    }
    renderTags();
  }

  function tagsFromNominatim(row) {
    const a = (row && row.address) || {};
    const values = [
      row && row.name,
      a.amenity,
      a.shop,
      a.tourism,
      a.leisure,
      a.building,
      a.road,
      a.neighbourhood || a.suburb || a.quarter || a.village || a.hamlet,
      a.city || a.town || a.municipality,
      a.county,
      a.state,
      a.country,
    ];
    const city = a.city || a.town || a.municipality || "";
    if (city && a.country) values.push(city + ", " + a.country);
    return ImageMeta.uniqueKeywords(values).slice(0, 12);
  }

  function placeFromNominatim(row) {
    const a = (row && row.address) || {};
    return {
      city: a.city || a.town || a.municipality || "",
      state: a.state || a.region || "",
      country: a.country || "",
      area: (row && row.name) || a.suburb || a.city || a.town || "",
    };
  }

  function businessName() {
    return normalizeTag(els.bizName ? els.bizName.value : "");
  }

  function applyPlace(row, statusText) {
    geoKeywords = tagsFromNominatim(row);
    placeInfo = placeFromNominatim(row);
    const biz = businessName();
    if (biz) {
      geoKeywords = ImageMeta.uniqueKeywords([biz].concat(geoKeywords));
      placeInfo.area = biz;
    }
    items.forEach((item) => {
      item.removedKeywords = (item.removedKeywords || []).filter((k) => {
        return !geoKeywords.some((g) => g.toLowerCase() === k);
      });
    });
    renderTags();
    if (statusText) {
      els.tagStatus.textContent = statusText;
      els.tagStatus.className = "tag-status ok";
    }
  }

  function localBusinesses() {
    try {
      const list = JSON.parse(localStorage.getItem(BIZ_LOCAL_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function setLocalBusinesses(list) {
    businesses = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    try {
      localStorage.setItem(BIZ_LOCAL_KEY, JSON.stringify(businesses));
    } catch {
      /* ignore quota */
    }
    renderBusinesses();
  }

  function renderBusinesses() {
    if (!els.bizList) return;
    const q = businessName().toLowerCase();
    const rows = q
      ? businesses.filter((row) => String(row.name || "").toLowerCase().indexOf(q) !== -1)
      : businesses;
    els.bizCount.textContent = String(businesses.length);
    els.bizList.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty-biz";
      empty.textContent = businesses.length
        ? "No saved name matches that filter."
        : "No saved businesses yet. Set a name and coordinates, then save.";
      els.bizList.appendChild(empty);
      return;
    }
    rows.forEach((row) => {
      const wrap = document.createElement("div");
      wrap.className = "biz-item" + (row.id === selectedBizId ? " active" : "");
      const main = document.createElement("button");
      main.type = "button";
      main.className = "biz-pick";
      main.innerHTML = '<div class="biz-name"></div><div class="biz-coords"></div>';
      main.querySelector(".biz-name").textContent = row.name;
      main.querySelector(".biz-coords").textContent =
        Number(row.lat).toFixed(6) + ", " + Number(row.lng).toFixed(6);
      main.addEventListener("click", () => selectBusiness(row));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "biz-del";
      del.setAttribute("aria-label", "Remove " + row.name);
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removeBusiness(row.id);
      });
      wrap.appendChild(main);
      wrap.appendChild(del);
      els.bizList.appendChild(wrap);
    });
  }

  function selectBusiness(row) {
    selectedBizId = row.id;
    els.bizName.value = row.name;
    placeInfo = {
      city: row.city || "",
      state: row.state || "",
      country: row.country || "",
      area: row.name,
    };
    geoKeywords = ImageMeta.uniqueKeywords([row.name, row.city, row.state, row.country]);
    renderTags();
    setLocation(Number(row.lat), Number(row.lng));
    renderBusinesses();
    toast("Loaded " + row.name);
  }

  async function loadBusinesses() {
    try {
      const res = await fetch(API_BASE + "/api/businesses");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load businesses");
      if (data.ephemeral) {
        setLocalBusinesses(localBusinesses());
        return;
      }
      setLocalBusinesses(data.businesses || []);
    } catch {
      setLocalBusinesses(localBusinesses());
    }
  }

  async function saveBusiness() {
    const name = businessName();
    const loc = readLocation();
    if (!name) return toast("Enter a business name first.");
    if (!loc) return toast("Set latitude and longitude first.");
    const payload = {
      name,
      lat: loc.lat,
      lng: loc.lng,
      altitude: loc.altitude,
      city: placeInfo.city || "",
      state: placeInfo.state || "",
      country: placeInfo.country || "",
      area: name,
    };
    try {
      const res = await fetch(API_BASE + "/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save business");
      if (data.ephemeral) throw new Error("ephemeral");
      selectedBizId = data.business && data.business.id;
      setLocalBusinesses(data.businesses || []);
      toast("Saved " + name + " at " + loc.lat.toFixed(6) + ", " + loc.lng.toFixed(6));
    } catch (err) {
      const local = localBusinesses();
      const key = name.toLowerCase();
      const existing = local.find((row) => String(row.name || "").trim().toLowerCase() === key);
      const saved = {
        id: (existing && existing.id) || "biz-" + Date.now().toString(36),
        name,
        lat: loc.lat,
        lng: loc.lng,
        altitude: loc.altitude,
        city: placeInfo.city || "",
        state: placeInfo.state || "",
        country: placeInfo.country || "",
        area: name,
        updatedAt: new Date().toISOString(),
      };
      const next = existing
        ? local.map((row) => (row.id === existing.id ? saved : row))
        : local.concat([saved]);
      selectedBizId = saved.id;
      setLocalBusinesses(next);
      toast("Saved " + name + " on this computer");
    }
  }

  async function removeBusiness(id) {
    try {
      const res = await fetch(API_BASE + "/api/businesses?id=" + encodeURIComponent(id), { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove business");
      if (data.ephemeral) throw new Error("ephemeral");
      if (selectedBizId === id) selectedBizId = null;
      setLocalBusinesses(data.businesses || []);
    } catch {
      if (selectedBizId === id) selectedBizId = null;
      setLocalBusinesses(localBusinesses().filter((row) => row.id !== id));
    }
  }

  async function reverseGeocode(lat, lng) {
    els.tagStatus.textContent = "Looking up location keywords…";
    els.tagStatus.className = "tag-status loading";
    try {
      const url =
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=" +
        encodeURIComponent(lat) +
        "&lon=" +
        encodeURIComponent(lng);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("lookup failed");
      const row = await res.json();
      applyPlace(row, "Location keywords added. You can still type more.");
    } catch {
      els.tagStatus.textContent = "Could not look up this place. You can still type tags.";
      els.tagStatus.className = "tag-status";
    }
  }

  function setLocation(lat, lng, opts) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    els.lat.value = Number(lat).toFixed(6);
    els.lng.value = Number(lng).toFixed(6);
    if (map) {
      const ll = [lat, lng];
      if (marker) marker.setLatLng(ll);
      else marker = L.marker(ll).addTo(map);
      if (!opts || opts.fly !== false) map.flyTo(ll, Math.max(map.getZoom(), 13), { duration: 0.45 });
      setTimeout(() => map.invalidateSize(), 60);
    }
    if (!opts || opts.reverse !== false) {
      clearTimeout(reverseTimer);
      reverseTimer = setTimeout(() => reverseGeocode(lat, lng), 450);
    }
  }

  function readLocation() {
    if (!String(els.lat.value || "").trim() || !String(els.lng.value || "").trim()) return null;
    const lat = Number(els.lat.value);
    const lng = Number(els.lng.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, altitude: null };
  }

  function initMap() {
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([12.8797, 121.774], 5);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);
    map.on("click", (e) => setLocation(e.latlng.lat, e.latlng.lng, { fly: false }));
    setTimeout(() => map.invalidateSize(), 80);
    window.addEventListener("resize", () => map.invalidateSize());
  }

  async function toJpeg(item) {
    if (item.kind === "jpeg") return item.current;
    const url = blobUrl(item.current, item.mime);
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode JPEG"))), "image/jpeg", 0.95);
    });
    const u8 = new Uint8Array(await blob.arrayBuffer());
    item.kind = "jpeg";
    item.mime = "image/jpeg";
    item.converted = true;
    item.outName = item.name.replace(/\.[^.]+$/, "") + ".jpg";
    return u8;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = url;
    });
  }

  async function bakeOrientation(u8, orientation) {
    if (!orientation || orientation === 1) return u8;
    const url = blobUrl(u8, "image/jpeg");
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (orientation >= 5) {
      canvas.width = h;
      canvas.height = w;
    } else {
      canvas.width = w;
      canvas.height = h;
    }
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
      default: break;
    }
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not bake orientation"))), "image/jpeg", 0.97);
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  function newItemKeywords(existing) {
    return {
      aiKeywords: [],
      fileKeywords: (existing || []).slice(),
      userKeywords: pendingUserKeywords.slice(),
      removedKeywords: [],
      tagState: "idle",
      tagError: "",
      description: "",
    };
  }

  function isImageFile(file) {
    if (!file || !file.name || file.name.charAt(0) === ".") return false;
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.type || "")) return true;
    return /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  }

  function alreadyAdded(file) {
    return items.some((item) => item.name === file.name && item.original && item.original.length === file.size);
  }

  function readDirEntries(dirEntry) {
    const reader = dirEntry.createReader();
    const all = [];
    return new Promise((resolve, reject) => {
      const next = () => {
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(all);
          all.push.apply(all, batch);
          next();
        }, reject);
      };
      next();
    });
  }

  async function collectEntry(entry, out) {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push(file);
      return;
    }
    if (entry.isDirectory) {
      const kids = await readDirEntries(entry);
      for (let i = 0; i < kids.length; i++) await collectEntry(kids[i], out);
    }
  }

  async function filesFromDrop(dataTransfer) {
    const bag = [];
    const items = dataTransfer && dataTransfer.items;
    if (items && items.length) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) entries.push(entry);
        else if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) bag.push(file);
        }
      }
      for (let i = 0; i < entries.length; i++) await collectEntry(entries[i], bag);
    }
    if (!bag.length) return Array.from((dataTransfer && dataTransfer.files) || []);
    return bag;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) {
      toast("No JPEG, PNG, WebP, or GIF files found.");
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const file of files) {
      if (alreadyAdded(file)) {
        skipped += 1;
        continue;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const kind = ImageMeta.sniffKind(buf, file);
      if (kind === "heic") {
        toast(file.name + ": HEIC is not supported. Export as JPEG first.");
        continue;
      }
      if (kind === "unknown") {
        toast(file.name + ": unsupported file.");
        continue;
      }
      const item = Object.assign({
        id: uid(),
        name: file.name,
        kind,
        mime: kind === "jpeg" ? "image/jpeg" : file.type || "image/" + kind,
        original: buf,
        current: buf,
        cleaned: false,
        converted: false,
        fields: [],
        gps: null,
        orientation: 1,
        preview: blobUrl(buf, file.type || "image/jpeg"),
      }, newItemKeywords());
      refreshMeta(item);
      if (item.fileKeywords && item.fileKeywords.length) {
        item.fileKeywords = item.fileKeywords.slice();
      }
      items.push(item);
      activeId = item.id;
      added += 1;
      tagItem(item);
      if (added % 12 === 0) render();
    }
    pendingUserKeywords = [];
    const firstGps = items.find((item) => item.gps);
    if (firstGps && firstGps.gps) setLocation(firstGps.gps.lat, firstGps.gps.lng);
    render();
    if (added) {
      toast("Added " + added + " image" + (added === 1 ? "" : "s") + (skipped ? " (" + skipped + " already in the list)" : ""));
    } else if (skipped) {
      toast("Those images are already in the list.");
    }
  }

  async function fileToTagDataUrl(item) {
    const url = item.preview;
    const img = await loadImage(url);
    const max = 1280;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > max || h > max) {
      const scale = max / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function tagItem(item) {
    if (!apiReady) {
      item.tagState = "idle";
      item.tagError = "";
      if (item.id === activeId) syncTagStatus();
      return;
    }
    item.tagState = "loading";
    item.tagError = "";
    if (item.id === activeId) syncTagStatus();
    try {
      const imageUrl = await fileToTagDataUrl(item);
      const res = await fetch(API_BASE + "/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, name: item.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "NO_KEY" || /API key/i.test(data.error || "")) {
          apiReady = false;
          els.apiBanner.classList.remove("hidden");
        }
        throw new Error(data.error || "Could not generate tags");
      }
      item.aiKeywords = ImageMeta.uniqueKeywords(data.keywords || []);
      if (data.description) item.description = String(data.description).trim();
      item.tagState = "done";
      if (item.id === activeId) {
        renderTags();
        syncDescription();
      }
    } catch (err) {
      item.tagState = "error";
      item.tagError = err.message || "Could not generate tags";
      if (item.id === activeId) syncTagStatus();
    }
  }

  async function stripItem(item) {
    if (item.kind === "jpeg") {
      const info = ImageMeta.readExif(item.current);
      let next = ImageMeta.stripJpegMetadata(item.current);
      if (info.orientation && info.orientation !== 1) {
        next = await bakeOrientation(next, info.orientation);
        next = ImageMeta.stripJpegMetadata(next);
      }
      item.current = next;
      item.cleaned = true;
    } else if (item.kind === "png") {
      item.current = ImageMeta.stripPngMetadata(item.current);
      item.cleaned = true;
    } else {
      const jpeg = await toJpeg(item);
      item.current = ImageMeta.stripJpegMetadata(jpeg);
      item.cleaned = true;
    }
    item.preview = blobUrl(item.current, item.mime);
    refreshMeta(item);
  }

  async function persistItem(item, loc) {
    let jpeg = item.current;
    if (item.kind !== "jpeg") jpeg = await toJpeg(item);
    const hasLoc = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
    const biz = businessName();
    const keywords = ImageMeta.uniqueKeywords((biz ? [biz] : []).concat(currentKeywords(item)));
    const description = (item.description || "").trim();
    if (keywords.length) item.keywords = keywords.slice();
    if (!hasLoc && !keywords.length && !description) return;
    item.current = ImageMeta.writeMeta(jpeg, {
      loc: hasLoc ? loc : null,
      description: description,
      keywords: keywords,
      place: Object.assign({}, placeInfo, { area: biz || placeInfo.area }),
      areaName: biz || placeInfo.area || keywords[0] || "",
      stripOthers: hasLoc ? els.stripOthers.checked : false,
    });
    item.kind = "jpeg";
    item.mime = "image/jpeg";
    if (hasLoc && els.stripOthers.checked) item.cleaned = true;
    item.preview = blobUrl(item.current, "image/jpeg");
    refreshMeta(item);
  }

  async function geoItem(item, loc) {
    await persistItem(item, loc);
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function selectedFormat() {
    const active = document.querySelector(".format-btn.active");
    return (active && active.getAttribute("data-format")) || "jpeg";
  }

  function formatFileName(item, format) {
    const base = (item.outName || item.name).replace(/\.[^.]+$/, "");
    const ext = format === "jpeg" ? "jpg" : format;
    return base + "." + ext;
  }

  async function rasterize(item, mime, quality) {
    const url = blobUrl(item.current, item.mime);
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode " + mime))),
        mime,
        quality
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function exportItem(item, format) {
    await persistItem(item, null);
    if (format === "jpeg") {
      if (item.kind !== "jpeg") {
        item.current = await toJpeg(item);
        item.kind = "jpeg";
        item.mime = "image/jpeg";
      }
      return { u8: item.current, mime: "image/jpeg", name: formatFileName(item, "jpeg") };
    }
    const mime = format === "png" ? "image/png" : "image/webp";
    const u8 = await rasterize(item, mime, format === "png" ? undefined : 0.92);
    return { u8, mime, name: formatFileName(item, format) };
  }

  function renderThumbs() {
    els.count.textContent = items.length + (items.length === 1 ? " file" : " files");
    els.thumbs.innerHTML = "";
    items.forEach((item) => {
      const badge = badgeFor(item);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb" + (item.id === activeId ? " active" : "");
      btn.innerHTML =
        '<img alt="" src="' + item.preview + '">' +
        '<span class="meta"><span class="name"></span><span class="sub"></span></span>' +
        '<span class="badge ' + badge.cls + '"></span>';
      btn.querySelector(".name").textContent = item.name;
      btn.querySelector(".sub").textContent = bytesLabel(item.current.length);
      btn.querySelector(".badge").textContent = badge.text;
      btn.addEventListener("click", () => {
        activeId = item.id;
        if (item.gps) setLocation(item.gps.lat, item.gps.lng);
        render();
      });
      els.thumbs.appendChild(btn);
    });
  }

  function syncDescription() {
    const item = activeItem();
    const loading = item && item.tagState === "loading";
    if (!item) {
      els.desc.value = "";
      els.desc.disabled = true;
      els.copyDesc.disabled = true;
      return;
    }
    if (document.activeElement !== els.desc) els.desc.value = item.description || "";
    els.desc.disabled = loading;
    els.copyDesc.disabled = !String(els.desc.value || "").trim();
  }

  function syncTagStatus() {
    const item = activeItem();
    const loading = item && item.tagState === "loading";
    els.retag.disabled = !item || loading;
    els.tagStatus.className = "tag-status";
    if (!item) {
      syncDescription();
      els.tagStatus.textContent = "Upload a photo for a short comma description and 10 LSI keywords.";
      return;
    }
    if (loading) {
      els.tagStatus.textContent = "Writing a short description and 10 LSI keywords…";
      els.tagStatus.classList.add("loading");
    } else if (item.tagState === "error") {
      els.tagStatus.textContent = item.tagError || "Could not generate description and tags";
      els.tagStatus.classList.add("error");
    } else if ((item.description || "").trim() || currentKeywords(item).length) {
      els.tagStatus.textContent = "Editable. Saved into the file when you download or add a geo tag.";
      els.tagStatus.classList.add("ok");
    } else if (!apiReady) {
      els.tagStatus.textContent = "Type a description and tags, or add an API key to generate them.";
    } else {
      els.tagStatus.textContent = "Add a description and tags, or generate them from the photo.";
    }
    syncDescription();
  }

  function renderPreview() {
    const item = activeItem();
    const disabled = !item;
    [els.strip, els.geo, els.download, els.remove].forEach((btn) => { btn.disabled = disabled; });
    els.stripAll.disabled = items.length === 0;
    els.geoAll.disabled = items.length === 0;
    els.zip.disabled = items.length === 0;

    if (!item) {
      els.title.textContent = "Preview";
      els.status.textContent = "";
      els.stage.innerHTML = '<div class="empty-preview"><h3>No photo selected</h3><p>Add one or more images to inspect EXIF, strip it, or write GPS.</p></div>';
      els.table.innerHTML = "";
      renderTags();
      syncDescription();
      return;
    }

    els.title.textContent = item.name;
    els.status.textContent = item.kind.toUpperCase() + " · " + bytesLabel(item.current.length);
    els.stage.innerHTML = "";
    const img = document.createElement("img");
    img.alt = item.name;
    img.src = item.preview;
    els.stage.appendChild(img);
    renderTags();

    if (!item.fields.length) {
      els.table.innerHTML = item.kind === "jpeg"
        ? '<p class="no-exif">No EXIF or GPS tags on this JPEG.</p>'
        : '<p class="no-exif">EXIF inspect works on JPEG. Convert happens only if you add a geo tag.</p>';
      return;
    }
    els.table.innerHTML = item.fields
      .map((row) => '<div class="exif-row"><dt></dt><dd></dd></div>')
      .join("");
    Array.from(els.table.children).forEach((node, i) => {
      node.querySelector("dt").textContent = item.fields[i].label;
      node.querySelector("dd").textContent = item.fields[i].value;
    });
  }

  function render() {
    renderThumbs();
    renderPreview();
  }

  ["dragenter", "dragover"].forEach((type) => {
    els.drop.addEventListener(type, (e) => {
      e.preventDefault();
      els.drop.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    els.drop.addEventListener(type, (e) => {
      e.preventDefault();
      els.drop.classList.remove("dragover");
    });
  });
  els.drop.addEventListener("drop", (e) => {
    filesFromDrop(e.dataTransfer).then(addFiles).catch(() => addFiles(e.dataTransfer.files));
  });
  els.input.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  if (els.folder) {
    els.folder.addEventListener("change", (e) => {
      addFiles(e.target.files);
      e.target.value = "";
    });
  }

  els.strip.addEventListener("click", async () => {
    const item = activeItem();
    if (!item) return;
    try {
      await stripItem(item);
      toast("EXIF removed from " + item.name);
      render();
    } catch (err) {
      toast(err.message || "Could not strip EXIF");
    }
  });

  els.stripAll.addEventListener("click", async () => {
    try {
      for (const item of items) await stripItem(item);
      toast("EXIF removed from " + items.length + " photo" + (items.length === 1 ? "" : "s"));
      render();
    } catch (err) {
      toast(err.message || "Could not strip EXIF");
    }
  });

  els.geo.addEventListener("click", async () => {
    const item = activeItem();
    const loc = readLocation();
    if (!item) return;
    if (!loc) return toast("Set a location on the map or enter coordinates first.");
    try {
      await geoItem(item, loc);
      toast("Geo tag and keywords written to " + outName(item));
      render();
    } catch (err) {
      toast(err.message || "Could not write GPS");
    }
  });

  els.geoAll.addEventListener("click", async () => {
    const loc = readLocation();
    if (!loc) return toast("Set a location on the map or enter coordinates first.");
    try {
      for (const item of items) await geoItem(item, loc);
      toast("Geo tag and keywords written to " + items.length + " photo" + (items.length === 1 ? "" : "s"));
      render();
    } catch (err) {
      toast(err.message || "Could not write GPS");
    }
  });

  els.formatBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.formatBtns.forEach((other) => other.classList.toggle("active", other === btn));
    });
  });

  els.download.addEventListener("click", async () => {
    const item = activeItem();
    if (!item) return;
    try {
      const format = selectedFormat();
      const exported = await exportItem(item, format);
      render();
      downloadBlob(new Blob([exported.u8], { type: exported.mime }), exported.name);
    } catch (err) {
      toast(err.message || "Could not save description and keywords");
    }
  });

  els.zip.addEventListener("click", async () => {
    if (!items.length || typeof JSZip === "undefined") return;
    try {
      const format = selectedFormat();
      const zip = new JSZip();
      const used = new Set();
      for (const item of items) {
        const exported = await exportItem(item, format);
        let name = exported.name;
        if (used.has(name)) {
          const parts = name.split(".");
          const ext = parts.pop();
          name = parts.join(".") + "-" + item.id.slice(-4) + "." + ext;
        }
        used.add(name);
        zip.file(name, exported.u8);
      }
      render();
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "seo-tools-photos.zip");
    } catch (err) {
      toast(err.message || "Could not build ZIP");
    }
  });

  els.remove.addEventListener("click", () => {
    const idx = items.findIndex((item) => item.id === activeId);
    if (idx < 0) return;
    items.splice(idx, 1);
    activeId = items[idx] ? items[idx].id : items[idx - 1] ? items[idx - 1].id : null;
    render();
  });

  els.locate.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Geolocation is not available.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
      () => toast("Could not read your location.")
    );
  });

  els.copy.addEventListener("click", async () => {
    const loc = readLocation();
    if (!loc) return toast("No coordinates to copy.");
    const text = loc.lat.toFixed(6) + ", " + loc.lng.toFixed(6);
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied " + text);
    } catch {
      toast(text);
    }
  });

  ["change", "input"].forEach((type) => {
    els.lat.addEventListener(type, () => {
      const loc = readLocation();
      if (loc) setLocation(loc.lat, loc.lng, { fly: type === "change" });
    });
    els.lng.addEventListener(type, () => {
      const loc = readLocation();
      if (loc) setLocation(loc.lat, loc.lng, { fly: type === "change" });
    });
  });

  els.tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addUserTag(els.tagInput.value);
      els.tagInput.value = "";
    } else if (e.key === "Backspace" && !els.tagInput.value) {
      const tags = currentKeywords(activeItem());
      if (tags.length) removeTag(tags[tags.length - 1]);
    }
  });
  els.tagInput.addEventListener("blur", () => {
    if (els.tagInput.value.trim()) {
      addUserTag(els.tagInput.value);
      els.tagInput.value = "";
    }
  });

  els.retag.addEventListener("click", () => {
    const item = activeItem();
    if (item) tagItem(item);
  });

  els.desc.addEventListener("input", () => {
    const item = activeItem();
    if (!item) return;
    item.description = els.desc.value;
    els.copyDesc.disabled = !item.description.trim();
  });

  els.copyDesc.addEventListener("click", async () => {
    const text = (els.desc.value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("Description copied");
    } catch {
      toast(text);
    }
  });

  els.saveKey.addEventListener("click", async () => {
    const key = (els.apiKey.value || "").trim();
    if (!key) return toast("Paste a Perplexity API key first.");
    try {
      const res = await fetch(API_BASE + "/api/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save key");
      apiReady = true;
      els.apiBanner.classList.add("hidden");
      els.apiKey.value = "";
      toast("API key saved on this computer");
      const item = activeItem();
      if (item && (!(item.aiKeywords || []).length || !(item.description || "").trim())) tagItem(item);
    } catch (err) {
      toast(err.message || "Start the tool with start.bat first.");
    }
  });

  async function checkApi() {
    try {
      const res = await fetch(API_BASE + "/api/status");
      const data = await res.json();
      apiReady = Boolean(data.configured || data.mock);
      els.apiBanner.classList.toggle("hidden", apiReady);
      if (!apiReady && data.hosted) {
        const note = els.apiBanner.querySelector("span");
        if (note) {
          note.innerHTML = 'Add <strong>PERPLEXITY_API_KEY</strong> in Vercel Project Settings → Environment Variables, then redeploy.';
        }
        if (els.apiKey) els.apiKey.classList.add("hidden");
        if (els.saveKey) els.saveKey.classList.add("hidden");
      }
    } catch {
      apiReady = false;
      els.apiBanner.classList.remove("hidden");
      els.tagStatus.textContent = "Start the tool with start.bat so auto tags can run.";
      els.tagStatus.className = "tag-status error";
    }
  }

  els.saveBiz.addEventListener("click", () => saveBusiness());
  els.bizName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveBusiness();
    }
  });
  els.bizName.addEventListener("input", () => renderBusinesses());

  initMap();
  render();
  checkApi();
  loadBusinesses();
})();

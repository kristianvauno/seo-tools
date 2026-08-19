/* JPEG / PNG metadata helpers. piexif is used only for EXIF GPS read/write. */

(function (global) {
  const SOI = [0xff, 0xd8];

  function u8ToBinary(u8) {
    const parts = [];
    const size = 0x8000;
    for (let i = 0; i < u8.length; i += size) {
      parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + size)));
    }
    return parts.join("");
  }

  function binaryToU8(bin) {
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
    return u8;
  }

  function sniffKind(u8, file) {
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "jpeg";
    if (
      u8.length >= 8 &&
      u8[0] === 0x89 &&
      u8[1] === 0x50 &&
      u8[2] === 0x4e &&
      u8[3] === 0x47
    ) {
      return "png";
    }
    if (
      u8.length >= 12 &&
      u8[0] === 0x52 &&
      u8[1] === 0x49 &&
      u8[2] === 0x46 &&
      u8[3] === 0x46 &&
      u8[8] === 0x57 &&
      u8[9] === 0x45 &&
      u8[10] === 0x42 &&
      u8[11] === 0x50
    ) {
      return "webp";
    }
    if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return "gif";
    const name = (file && file.name) || "";
    if (/\.(heic|heif)$/i.test(name) || (file && /heic|heif/i.test(file.type || ""))) return "heic";
    if (/\.jpe?g$/i.test(name)) return "jpeg";
    if (/\.png$/i.test(name)) return "png";
    if (/\.webp$/i.test(name)) return "webp";
    return "unknown";
  }

  function isJpeg(u8) {
    return u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
  }

  function stripJpegMetadata(u8, opts) {
    const keepIcc = !opts || opts.keepIcc !== false;
    if (!isJpeg(u8)) throw new Error("Not a JPEG");
    const out = [];
    out.push(0xff, 0xd8);
    let offset = 2;
    while (offset < u8.length) {
      if (u8[offset] !== 0xff) break;
      while (offset < u8.length && u8[offset] === 0xff) offset++;
      if (offset >= u8.length) break;
      const marker = u8[offset++];
      if (marker === 0xd9) {
        out.push(0xff, 0xd9);
        break;
      }
      if (marker === 0xda) {
        out.push(0xff, 0xda);
        for (let i = offset; i < u8.length; i++) out.push(u8[i]);
        break;
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        out.push(0xff, marker);
        continue;
      }
      if (offset + 1 >= u8.length) break;
      const len = (u8[offset] << 8) | u8[offset + 1];
      const payloadStart = offset;
      const payloadEnd = offset + len;
      offset = payloadEnd;
      const drop =
        marker === 0xe1 ||
        marker === 0xed ||
        marker === 0xfe ||
        marker === 0xe3 ||
        marker === 0xe4 ||
        marker === 0xe5 ||
        marker === 0xe6;
      if (drop) continue;
      if (marker === 0xe2 && !keepIcc) continue;
      out.push(0xff, marker);
      for (let i = payloadStart; i < payloadEnd && i < u8.length; i++) out.push(u8[i]);
    }
    return Uint8Array.from(out);
  }

  function stripPngMetadata(u8) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (u8[i] !== sig[i]) throw new Error("Not a PNG");
    }
    const drop = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
    const out = [137, 80, 78, 71, 13, 10, 26, 10];
    let offset = 8;
    while (offset + 12 <= u8.length) {
      const len = (u8[offset] << 24) | (u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3];
      const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
      const chunkEnd = offset + 12 + len;
      if (chunkEnd > u8.length) break;
      if (!drop.has(type)) {
        for (let i = offset; i < chunkEnd; i++) out.push(u8[i]);
      }
      offset = chunkEnd;
      if (type === "IEND") break;
    }
    return Uint8Array.from(out);
  }

  function rational(v) {
    if (!v) return null;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") {
      return v[1] ? v[0] / v[1] : null;
    }
    return null;
  }

  function prettyExposure(v) {
    const n = rational(v);
    if (n == null) return null;
    if (n >= 1) return n.toFixed(1) + "s";
    return "1/" + Math.round(1 / n) + "s";
  }

  function readExif(u8) {
    const empty = { fields: [], gps: null, orientation: 1, raw: null };
    if (!isJpeg(u8) || typeof piexif === "undefined") return empty;
    let obj;
    try {
      obj = piexif.load(u8ToBinary(u8));
    } catch {
      return empty;
    }
    const zeroth = obj["0th"] || {};
    const exif = obj.Exif || {};
    const gpsIfd = obj.GPS || {};
    const fields = [];
    const push = (label, value) => {
      if (value === undefined || value === null || value === "") return;
      fields.push({ label, value: String(value) });
    };
    const imageDescription = zeroth[piexif.ImageIFD.ImageDescription] || "";
    push("Image description", imageDescription);
    push("Camera make", zeroth[piexif.ImageIFD.Make]);
    push("Camera model", zeroth[piexif.ImageIFD.Model]);
    push("Software", zeroth[piexif.ImageIFD.Software]);
    push("Date taken", exif[piexif.ExifIFD.DateTimeOriginal] || zeroth[piexif.ImageIFD.DateTime]);
    push("Lens", exif[piexif.ExifIFD.LensModel]);
    const iso = exif[piexif.ExifIFD.ISOSpeedRatings];
    push("ISO", Array.isArray(iso) ? iso[0] : iso);
    const fnum = rational(exif[piexif.ExifIFD.FNumber]);
    if (fnum != null) push("Aperture", "f/" + (Math.round(fnum * 10) / 10));
    push("Shutter", prettyExposure(exif[piexif.ExifIFD.ExposureTime]));
    const focal = rational(exif[piexif.ExifIFD.FocalLength]);
    if (focal != null) push("Focal length", Math.round(focal) + "mm");
    const orient = zeroth[piexif.ImageIFD.Orientation] || 1;
    if (orient && orient !== 1) push("Orientation", orient);

    let gps = null;
    try {
      const latArr = gpsIfd[piexif.GPSIFD.GPSLatitude];
      const lngArr = gpsIfd[piexif.GPSIFD.GPSLongitude];
      const latRef = gpsIfd[piexif.GPSIFD.GPSLatitudeRef] || "N";
      const lngRef = gpsIfd[piexif.GPSIFD.GPSLongitudeRef] || "E";
      if (latArr && lngArr) {
        const lat = piexif.GPSHelper.dmsRationalToDeg(latArr, latRef);
        const lng = piexif.GPSHelper.dmsRationalToDeg(lngArr, lngRef);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const altR = gpsIfd[piexif.GPSIFD.GPSAltitude];
          const altRef = gpsIfd[piexif.GPSIFD.GPSAltitudeRef] || 0;
          let altitude = null;
          const altN = rational(altR);
          if (altN != null) altitude = (altRef === 1 ? -1 : 1) * altN;
          gps = { lat, lng, altitude };
          push("GPS", lat.toFixed(6) + ", " + lng.toFixed(6));
          if (altitude != null) push("Altitude", Math.round(altitude) + " m");
        }
      }
    } catch {
      /* ignore broken GPS IFD */
    }

    const xp = decodeXp(zeroth[piexif.ImageIFD.XPKeywords]);
    const iptc = readIptc(u8);
    const keywords = uniqueKeywords([].concat(xp ? xp.split(/\s*;\s*/) : [], iptc.keywords || []));
    if (keywords.length) push("Keywords", keywords.join(", "));
    if (iptc.category) push("Category", iptc.category);
    if (!imageDescription && iptc.caption) push("Image description", iptc.caption);
    if (iptc.city) push("City", iptc.city);
    if (iptc.state) push("State", iptc.state);
    if (iptc.country) push("Country", iptc.country);

    return {
      fields,
      gps,
      orientation: orient || 1,
      raw: obj,
      keywords,
      iptc,
      description: String(imageDescription || (iptc && iptc.caption) || "").trim(),
      category: String((iptc && iptc.category) || "").trim(),
    };
  }

  function uniqueKeywords(list) {
    const out = [];
    const seen = new Set();
    (list || []).forEach((raw) => {
      const value = String(raw || "").replace(/\s+/g, " ").trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(value);
    });
    return out;
  }

  function decodeXp(bytes) {
    if (!bytes || !bytes.length) return "";
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const c = (bytes[i] & 0xff) | ((bytes[i + 1] & 0xff) << 8);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }

  function encodeXp(text) {
    const s = String(text || "");
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out.push(c & 0xff, (c >> 8) & 0xff);
    }
    out.push(0, 0);
    return out;
  }

  function encodeAsciiBytes(text) {
    const s = String(text || "");
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function readIptc(u8) {
    const empty = { keywords: [], city: "", state: "", country: "", caption: "", category: "" };
    if (!isJpeg(u8)) return empty;
    let offset = 2;
    while (offset + 4 < u8.length && u8[offset] === 0xff) {
      while (offset < u8.length && u8[offset] === 0xff) offset++;
      if (offset >= u8.length) break;
      const marker = u8[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 1 >= u8.length) break;
      const len = (u8[offset] << 8) | u8[offset + 1];
      const start = offset + 2;
      const end = offset + len;
      offset = end;
      if (marker !== 0xed) continue;
      const body = u8.subarray(start, end);
      const keywords = [];
      let city = "";
      let state = "";
      let country = "";
      let caption = "";
      let category = "";
      for (let i = 0; i + 4 < body.length; i++) {
        if (body[i] !== 0x1c) continue;
        const record = body[i + 1];
        const dataset = body[i + 2];
        const dlen = (body[i + 3] << 8) | body[i + 4];
        if (i + 5 + dlen > body.length) continue;
        if (record !== 2) {
          i += 4 + dlen;
          continue;
        }
        let text = "";
        for (let j = 0; j < dlen; j++) text += String.fromCharCode(body[i + 5 + j]);
        text = text.trim();
        if (dataset === 25 && text) keywords.push(text);
        if (dataset === 90 && text) city = text;
        if (dataset === 95 && text) state = text;
        if (dataset === 101 && text) country = text;
        if (dataset === 120 && text) caption = text;
        if (dataset === 15 && text && !category) category = text;
        if (dataset === 20 && text) category = text;
        i += 4 + dlen;
      }
      return { keywords: uniqueKeywords(keywords), city, state, country, caption, category };
    }
    return empty;
  }

  function iptcDataset(record, dataset, text) {
    const bytes = encodeAsciiBytes(text);
    if (bytes.length > 65533) bytes.length = 65533;
    return [0x1c, record, dataset, (bytes.length >> 8) & 0xff, bytes.length & 0xff].concat(bytes);
  }

  function buildIptcBlock(info) {
    const parts = [0x1c, 2, 0, 0, 2, 0, 2];
    (info.keywords || []).forEach((word) => {
      const clean = asciiSafe(word).slice(0, 64);
      if (clean) parts.push.apply(parts, iptcDataset(2, 25, clean));
    });
    if (info.city) parts.push.apply(parts, iptcDataset(2, 90, asciiSafe(info.city).slice(0, 32)));
    if (info.state) parts.push.apply(parts, iptcDataset(2, 95, asciiSafe(info.state).slice(0, 32)));
    if (info.country) parts.push.apply(parts, iptcDataset(2, 101, asciiSafe(info.country).slice(0, 64)));
    if (info.caption) parts.push.apply(parts, iptcDataset(2, 120, asciiSafe(info.caption, 2000)));
    if (info.category) {
      const cat = asciiSafe(info.category).slice(0, 64);
      if (cat) parts.push.apply(parts, iptcDataset(2, 20, cat));
    }
    return parts;
  }

  function buildApp13(iptcBytes) {
    const header = encodeAsciiBytes("Photoshop 3.0\0");
    const irb = [0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0x00, 0x00];
    const len = iptcBytes.length;
    irb.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
    const block = header.concat(irb, iptcBytes);
    if (len % 2) block.push(0);
    const seglen = block.length + 2;
    return [0xff, 0xed, (seglen >> 8) & 0xff, seglen & 0xff].concat(block);
  }

  function dropJpegMarkers(u8, markers) {
    if (!isJpeg(u8)) return u8;
    const drop = new Set(markers || []);
    const out = [0xff, 0xd8];
    let offset = 2;
    while (offset < u8.length) {
      if (u8[offset] !== 0xff) break;
      while (offset < u8.length && u8[offset] === 0xff) offset++;
      if (offset >= u8.length) break;
      const marker = u8[offset++];
      if (marker === 0xd9) {
        out.push(0xff, 0xd9);
        break;
      }
      if (marker === 0xda) {
        out.push(0xff, 0xda);
        for (let i = offset; i < u8.length; i++) out.push(u8[i]);
        break;
      }
      if (offset + 1 >= u8.length) break;
      const len = (u8[offset] << 8) | u8[offset + 1];
      const payloadStart = offset;
      const payloadEnd = offset + len;
      offset = payloadEnd;
      if (drop.has(marker)) continue;
      out.push(0xff, marker);
      for (let i = payloadStart; i < payloadEnd && i < u8.length; i++) out.push(u8[i]);
    }
    return Uint8Array.from(out);
  }

  function insertAfterHeaders(u8, segment) {
    let offset = 2;
    while (offset + 4 < u8.length && u8[offset] === 0xff) {
      let i = offset + 1;
      while (i < u8.length && u8[i] === 0xff) i++;
      const marker = u8[i];
      if (marker === 0xe0 || marker === 0xe1) {
        const len = (u8[i + 1] << 8) | u8[i + 2];
        offset = i + 1 + len;
        continue;
      }
      break;
    }
    const out = new Uint8Array(u8.length + segment.length);
    out.set(u8.subarray(0, offset), 0);
    out.set(segment, offset);
    out.set(u8.subarray(offset), offset + segment.length);
    return out;
  }

  function asciiSafe(text, max) {
    return String(text || "")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 220);
  }

  function writeMeta(u8, options) {
    if (typeof piexif === "undefined") throw new Error("EXIF library missing");
    if (!isJpeg(u8)) throw new Error("EXIF can only be written to JPEG");
    const opts = options || {};
    const loc = opts.loc || null;
    const description = (opts.description || "").trim();
    const stripOthers = opts.stripOthers !== false;
    const jpegU8 = stripOthers ? stripJpegMetadata(u8) : u8;
    const jpeg = u8ToBinary(jpegU8);
    let exifObj;
    if (stripOthers) {
      exifObj = { "0th": {}, Exif: {}, GPS: {}, "1st": {}, thumbnail: null };
      exifObj["0th"][piexif.ImageIFD.Software] = "SEO Tools";
    } else {
      try {
        exifObj = piexif.load(jpeg);
      } catch {
        exifObj = { "0th": {}, Exif: {}, GPS: {}, "1st": {}, thumbnail: null };
      }
    }
    if (description) {
      exifObj["0th"][piexif.ImageIFD.ImageDescription] = asciiSafe(description, 500);
    }
    const keywords = uniqueKeywords(opts.keywords || []);
    if (keywords.length) {
      exifObj["0th"][piexif.ImageIFD.XPKeywords] = encodeXp(keywords.join("; "));
    }
    if (loc) {
      const lat = Number(loc.lat);
      const lng = Number(loc.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Invalid coordinates");
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("Coordinates out of range");
      const gps = exifObj.GPS || {};
      gps[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0];
      gps[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S";
      gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
      gps[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W";
      gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lng));
      if (loc.altitude !== null && loc.altitude !== undefined && loc.altitude !== "") {
        const alt = Number(loc.altitude);
        if (Number.isFinite(alt)) {
          gps[piexif.GPSIFD.GPSAltitudeRef] = alt < 0 ? 1 : 0;
          gps[piexif.GPSIFD.GPSAltitude] = [Math.round(Math.abs(alt) * 100), 100];
        }
      }
      if (opts.areaName) {
        const area = asciiSafe(opts.areaName).slice(0, 80);
        if (area) {
          gps[piexif.GPSIFD.GPSAreaInformation] = [65, 83, 67, 73, 73, 0, 0, 0].concat(encodeAsciiBytes(area), [0]);
        }
      }
      exifObj.GPS = gps;
    }
    const dumped = piexif.dump(exifObj);
    let out = binaryToU8(piexif.insert(dumped, jpeg));
    const place = opts.place || {};
    const category = (opts.category || "").trim();
    if (keywords.length || place.city || place.state || place.country || description || category) {
      out = dropJpegMarkers(out, [0xed]);
      const iptc = buildIptcBlock({
        keywords,
        city: place.city,
        state: place.state,
        country: place.country,
        caption: description,
        category: category,
      });
      out = insertAfterHeaders(out, Uint8Array.from(buildApp13(iptc)));
    }
    return out;
  }

  function writeGps(u8, loc, options) {
    return writeMeta(u8, Object.assign({}, options || {}, { loc: loc }));
  }

  function jpegHasApp1(u8) {
    if (!isJpeg(u8)) return false;
    let offset = 2;
    while (offset + 4 < u8.length) {
      if (u8[offset] !== 0xff) return false;
      while (offset < u8.length && u8[offset] === 0xff) offset++;
      if (offset >= u8.length) return false;
      const marker = u8[offset++];
      if (marker === 0xda || marker === 0xd9) return false;
      if (offset + 1 >= u8.length) return false;
      const len = (u8[offset] << 8) | u8[offset + 1];
      if (marker === 0xe1) return true;
      offset += len;
    }
    return false;
  }

  global.ImageMeta = {
    u8ToBinary,
    binaryToU8,
    sniffKind,
    isJpeg,
    stripJpegMetadata,
    stripPngMetadata,
    readExif,
    writeMeta,
    writeGps,
    jpegHasApp1,
    uniqueKeywords,
  };
})(window);

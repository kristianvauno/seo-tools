const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const PPLX_MODEL = "sonar-pro";
const XAI_MODEL = "grok-4.6";
const DATA_DIR = path.join(ROOT, "data");
const BIZ_PATH = path.join(DATA_DIR, "businesses.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function isVercel() {
  return process.env.VERCEL === "1";
}

function envNameForKey(key) {
  if (/^xai-/i.test(key)) return "XAI_API_KEY";
  return "PERPLEXITY_API_KEY";
}

function getPerplexityKey() {
  return (process.env.PERPLEXITY_API_KEY || "").trim();
}

function getXaiKey() {
  return (process.env.XAI_API_KEY || "").trim();
}

function getApiKey() {
  return getPerplexityKey() || getXaiKey();
}

function saveApiKey(key) {
  const clean = String(key || "").trim();
  if (!clean) throw new Error("API key is empty");
  if (isVercel()) {
    const err = new Error("On Vercel, set PERPLEXITY_API_KEY in Project Settings → Environment Variables, then redeploy.");
    err.code = "NO_KEY";
    throw err;
  }
  const envName = envNameForKey(clean);
  process.env[envName] = clean;
  const drop = new RegExp("^\\s*" + envName + "\\s*=");
  const other = fs.existsSync(ENV_PATH)
    ? fs
        .readFileSync(ENV_PATH, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() && !drop.test(line))
    : [];
  fs.writeFileSync(ENV_PATH, other.concat([envName + "=" + clean]).join("\n") + "\n", "utf8");
}

function send(res, status, body, headers) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? "" : String(body));
  res.writeHead(status, Object.assign({ "Content-Length": payload.length }, headers || {}));
  res.end(payload);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function getJsonBody(req, limit) {
  if (req.body != null && req.body !== "") {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8") || "{}");
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (typeof req.body === "object") return req.body;
  }
  const raw = await readBody(req, limit);
  return JSON.parse(raw.toString("utf8") || "{}");
}

function outputText(data) {
  if (!data) return "";
  const chat = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof chat === "string" && chat.trim()) return chat.trim();
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if ((c.type === "output_text" || c.type === "text") && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

const SYSTEM_PROMPT =
  "You are an SEO specialist with 15 years of experience writing image SEO, LSI keywords, and alt text for local business and real estate photos. Be factual. Reply with JSON only.";

const DESCRIBE_PROMPT =
  'Return JSON only, no markdown: {"category":"short category","description":"short, comma, separated, details","keywords":["lsi1","lsi2","lsi3","lsi4","lsi5","lsi6","lsi7","lsi8","lsi9","lsi10"]}. Category: 1 to 3 words naming the photo type (for example Real Estate, Restaurant, Powder Coating). Image description: one short line, 4 to 8 visible details separated by commas, no full sentences, no period, no quotes, hashtags, emojis, or the words image, photo, or picture. Do not invent a business name or city. Keywords: exactly 10 LSI keywords for what is visible and closely related search terms (subject, materials, style, use). Short phrases. No hashtags. No city or business name unless readable in the picture.';

function cleanDescription(text) {
  return String(text || "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\b(this )?(image|photo|picture|shot)\b/gi, " ")
    .replace(/[.!?]+/g, ",")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^,|,$/g, "")
    .trim();
}

function uniqueKeywords(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((raw) => {
    const value = String(raw || "")
      .replace(/^#/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.slice(0, 10);
}

function parseKeywordPayload(text) {
  const raw = String(text || "").trim();
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(fenced.slice(start, end + 1));
      const description = cleanDescription(obj.description || obj.alt || obj.caption || "");
      const keywords = uniqueKeywords(obj.keywords || obj.tags || []);
      const category = cleanDescription(obj.category || obj.topic || "");
      if (description || keywords.length || category) return { description, keywords, category };
    } catch {
      /* fall through */
    }
  }
  const listed = uniqueKeywords(
    fenced
      .split(/[\n,;]+/)
      .map((part) => part.replace(/^[-*#\d.)\s]+/, ""))
      .filter(Boolean)
  );
  if (listed.length > 1 && listed.every((word) => word.split(" ").length <= 4)) {
    return { description: "", keywords: listed, category: "" };
  }
  return { description: cleanDescription(fenced), keywords: listed, category: "" };
}

async function callJsonApi(url, key, body, label) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(label + " returned a non-JSON response");
  }
  if (!res.ok) {
    const msg = (data && (data.error && data.error.message)) || data.error || raw.slice(0, 240);
    throw new Error(typeof msg === "string" ? msg : label + " request failed");
  }
  return data;
}

async function keywordImagePerplexity(imageUrl, key) {
  const data = await callJsonApi(
    "https://api.perplexity.ai/chat/completions",
    key,
    {
      model: PPLX_MODEL,
      disable_search: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: DESCRIBE_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    },
    "Perplexity"
  );
  return parseKeywordPayload(outputText(data));
}

async function keywordImageXai(imageUrl, key) {
  const data = await callJsonApi(
    "https://api.x.ai/v1/responses",
    key,
    {
      model: XAI_MODEL,
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: imageUrl, detail: "high" },
            { type: "input_text", text: DESCRIBE_PROMPT },
          ],
        },
      ],
    },
    "xAI"
  );
  return parseKeywordPayload(outputText(data));
}

async function keywordImage(imageUrl) {
  if (process.env.SEO_TOOLS_MOCK_AI === "1") {
    return {
      description: "solid red rectangle, dark background, flat color, test graphic",
      category: "Graphic",
      keywords: [
        "red background",
        "solid color",
        "color block",
        "minimal backdrop",
        "plain wall",
        "studio background",
        "monochrome red",
        "abstract fill",
        "blank canvas",
        "graphic overlay",
      ],
    };
  }
  const pplx = getPerplexityKey();
  const xai = getXaiKey();
  if (!pplx && !xai) {
    const err = new Error(isVercel()
      ? "Missing PERPLEXITY_API_KEY. Add it in Vercel Project Settings → Environment Variables."
      : "Missing API key");
    err.code = "NO_KEY";
    throw err;
  }
  const parsed = pplx
    ? await keywordImagePerplexity(imageUrl, pplx)
    : await keywordImageXai(imageUrl, xai);
  if (!parsed.description && !parsed.keywords.length) throw new Error("Model returned no description or tags");
  return parsed;
}

const GH_REPO = process.env.GITHUB_REPO || "kristianvauno/seo-tools";
const GH_PATH = "data/businesses.json";
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

function githubToken() {
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
}

function githubHeaders(raw) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "User-Agent": "seo-tools",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = githubToken();
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function loadBusinessesFile() {
  try {
    const list = JSON.parse(fs.readFileSync(BIZ_PATH, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeBusinessesFile(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BIZ_PATH, JSON.stringify(list, null, 2), "utf8");
}

async function loadBusinessesGithub() {
  const res = await fetch(
    "https://api.github.com/repos/" + GH_REPO + "/contents/" + GH_PATH + "?ref=" + encodeURIComponent(GH_BRANCH),
    { headers: githubHeaders(true), cache: "no-store" }
  );
  if (!res.ok) return [];
  const list = await res.json();
  return Array.isArray(list) ? list : [];
}

async function githubFileSha() {
  const res = await fetch(
    "https://api.github.com/repos/" + GH_REPO + "/contents/" + GH_PATH + "?ref=" + encodeURIComponent(GH_BRANCH),
    { headers: githubHeaders(false), cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.sha ? data.sha : null;
}

async function writeBusinessesGithub(list) {
  const token = githubToken();
  if (!token) return false;
  const sha = await githubFileSha();
  const content = Buffer.from(JSON.stringify(list, null, 2), "utf8").toString("base64");
  const body = {
    message: "Update saved businesses",
    content: content,
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch("https://api.github.com/repos/" + GH_REPO + "/contents/" + GH_PATH, {
    method: "PUT",
    headers: Object.assign(githubHeaders(false), { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function loadBusinesses() {
  if (!isVercel()) {
    const local = loadBusinessesFile();
    if (local.length) return local;
  }
  try {
    const remote = await loadBusinessesGithub();
    if (remote.length && !isVercel()) {
      try {
        writeBusinessesFile(remote);
      } catch {
        /* ignore */
      }
    }
    if (remote.length) return remote;
  } catch {
    /* fall through */
  }
  return loadBusinessesFile();
}

async function writeBusinesses(list) {
  try {
    writeBusinessesFile(list);
  } catch {
    /* Vercel filesystem is read-only */
  }
  try {
    await writeBusinessesGithub(list);
  } catch {
    /* keep going; local file or in-memory response still works */
  }
}

function badBiz(message) {
  const err = new Error(message);
  err.code = "BAD_BIZ";
  return err;
}

function normalizeBusiness(body, existing) {
  const name = String((body && body.name) || "").replace(/\s+/g, " ").trim();
  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  if (!name) throw badBiz("Business name is required");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badBiz("Latitude and longitude are required");
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw badBiz("Coordinates out of range");
  let altitude = null;
  if (body && body.altitude !== "" && body.altitude != null) {
    const alt = Number(body.altitude);
    if (Number.isFinite(alt)) altitude = alt;
  }
  return {
    id: (existing && existing.id) || "biz-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    name,
    lat,
    lng,
    altitude,
    city: String((body && body.city) || "").trim(),
    state: String((body && body.state) || "").trim(),
    country: String((body && body.country) || "").trim(),
    area: String((body && body.area) || name).trim(),
    updatedAt: new Date().toISOString(),
  };
}

async function upsertBusiness(body) {
  const list = await loadBusinesses();
  const nameKey = String((body && body.name) || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const existing = list.find((row) => String(row.name || "").trim().toLowerCase() === nameKey);
  const next = normalizeBusiness(body, existing);
  const out = existing
    ? list.map((row) => (row.id === existing.id ? next : row))
    : list.concat([next]);
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  await writeBusinesses(out);
  return { saved: next, businesses: out };
}

async function deleteBusiness(id) {
  const list = await loadBusinesses();
  const next = list.filter((row) => row.id !== id);
  if (next.length === list.length) throw badBiz("Business not found");
  await writeBusinesses(next);
  return { businesses: next };
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = decodeURIComponent(rel.split("?")[0]);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
  });
}

async function handler(req, res) {
  cors(res);
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "127.0.0.1"));
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(getApiKey()),
        provider: getPerplexityKey() ? "perplexity" : getXaiKey() ? "xai" : "",
        mock: process.env.SEO_TOOLS_MOCK_AI === "1",
        hosted: isVercel(),
        ephemeral: false,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/key") {
      const body = await getJsonBody(req, 32 * 1024);
      saveApiKey(body.key);
      sendJson(res, 200, { ok: true, configured: true });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/keywords" || url.pathname === "/api/describe")) {
      const body = await getJsonBody(req, 8 * 1024 * 1024);
      const imageUrl = String(body.image_url || "");
      if (!imageUrl.startsWith("data:image/")) {
        sendJson(res, 400, { error: "Send a data URL image." });
        return;
      }
      const result = await keywordImage(imageUrl);
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === "/api/businesses") {
      if (req.method === "GET") {
        sendJson(res, 200, { businesses: await loadBusinesses() });
        return;
      }
      if (req.method === "POST") {
        const body = await getJsonBody(req, 32 * 1024);
        const result = await upsertBusiness(body);
        sendJson(res, 200, { ok: true, business: result.saved, businesses: result.businesses });
        return;
      }
      if (req.method === "DELETE") {
        const id = String(url.searchParams.get("id") || "").trim();
        if (!id) throw badBiz("Business id is required");
        const result = await deleteBusiness(id);
        sendJson(res, 200, { ok: true, businesses: result.businesses });
        return;
      }
    }

    if (req.method === "GET" && !isVercel()) {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.code === "NO_KEY" || err.code === "BAD_BIZ" ? 400 : 500;
    sendJson(res, status, { error: err.message || "Server error", code: err.code || "" });
  }
}

module.exports = handler;
module.exports.config = {
  maxDuration: 30,
  api: { bodyParser: { sizeLimit: "4mb" } },
};

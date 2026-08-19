const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8788;
const ENV_PATH = path.join(ROOT, ".env");

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile();

const handler = require("./lib/handler");

if (require.main === module && process.env.VERCEL !== "1") {
  http.createServer(handler).listen(PORT, "127.0.0.1", () => {
    console.log("SEO Tools running at http://127.0.0.1:" + PORT + "/");
    if (!process.env.PERPLEXITY_API_KEY && !process.env.XAI_API_KEY && process.env.SEO_TOOLS_MOCK_AI !== "1") {
      console.log("No API key yet. Add a Perplexity key in the page, or put PERPLEXITY_API_KEY in .env");
    }
  });
}

module.exports = handler;

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 5174);
const launchedAt = Date.now();
let hasHeartbeat = false;
let lastHeartbeatAt = launchedAt;
let shuttingDown = false;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

function safePath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split("?")[0]);
  const target = cleaned === "/" ? "/index.html" : cleaned;
  const filePath = normalize(join(root, target));
  if (!resolve(filePath).startsWith(resolve(root))) return null;
  return filePath;
}

function sendNoContent(res) {
  res.writeHead(204, {
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end();
}

async function proxyFetch(res, rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("invalid url");
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("unsupported protocol");
    return;
  }

  try {
    const upstream = await fetch(target.href, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8"
      }
    });
    const body = await upstream.text();
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(`fetch failed: ${error && error.message ? error.message : error}`);
  }
}

async function proxyOpenAI(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("method not allowed");
    return;
  }

  const apiKey = req.headers.authorization || "";
  if (!apiKey.toLowerCase().startsWith("bearer ")) {
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    res.end("missing authorization");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": apiKey
        },
        body: Buffer.concat(chunks)
      });
      const body = await upstream.text();
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      });
      res.end(body);
    } catch (error) {
      res.writeHead(502, {
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*"
      });
      res.end(`openai proxy failed: ${error && error.message ? error.message : error}`);
    }
  });
}

function shutdownSoon() {
  if (shuttingDown) return;
  shuttingDown = true;

  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }, 300).unref();
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (requestUrl.pathname === "/__heartbeat") {
    hasHeartbeat = true;
    lastHeartbeatAt = Date.now();
    sendNoContent(res);
    return;
  }

  if (requestUrl.pathname === "/__shutdown") {
    sendNoContent(res);
    shutdownSoon();
    return;
  }

  if (requestUrl.pathname === "/__fetch") {
    proxyFetch(res, requestUrl.searchParams.get("url") || "");
    return;
  }

  if (requestUrl.pathname === "/__openai") {
    proxyOpenAI(req, res);
    return;
  }

  const filePath = safePath(req.url || "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`blogy is running at http://127.0.0.1:${port}`);
});

setInterval(() => {
  const now = Date.now();
  if (hasHeartbeat && now - lastHeartbeatAt > 12000) {
    shutdownSoon();
  }

  if (!hasHeartbeat && now - launchedAt > 60000) {
    shutdownSoon();
  }
}, 3000).unref();

import https from "https";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { handleFileRequest } from "./fileserver.js";
import { lookup } from "mime-types";
import { handleAudioRequest } from "./audioserver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");


const tlsOpts = {
  key: fs.readFileSync("./cert/key.pem"),
  cert: fs.readFileSync("./cert/cert.pem")
};

// ─── Chat history ────────────────────────────────────────
const LOG_FILE = "./chat.log.gz";
let history = [];

if (fs.existsSync(LOG_FILE)) {
  const compressed = fs.readFileSync(LOG_FILE);
  const data = zlib.gunzipSync(compressed).toString("utf8");
  history = data
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "video/ogg",
    ".json": "application/json",
    ".txt": "text/plain"
  };
  return map[ext] || "application/octet-stream";
}

// ─── HTTPS server ─────────────────────────────────────────
const server = https.createServer(tlsOpts, (req, res) => {
  // 1️⃣ File server FIRST
  if (handleFileRequest(req, res)) {
    return;
  }
if (handleAudioRequest(req, res)) return;

  // 2️⃣ Static files (GET only)
  if (req.method === "GET") {
    const urlPath = decodeURIComponent(
      new URL(req.url, `https://${req.headers.host}`).pathname
    );
    const safePath = path.normalize(path.join(publicDir, urlPath));

    if (
      safePath.startsWith(publicDir) &&
      fs.existsSync(safePath) &&
      fs.statSync(safePath).isFile()
    ) {
      const type = lookup(safePath) || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // Fallback page
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(path.join(publicDir, "index.html")).pipe(res);
    return;
  }

  // 3️⃣ Anything else
  res.writeHead(404);
  res.end();
});


// ─── WebSocket server ─────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on("connection", ws => {
  clients.add(ws);

  // Send history on connect
  ws.send(JSON.stringify({
    system: true,
    history
  }));

  broadcast({ system: true, msg: "Someone connected." });

  ws.on("message", data => {
    const msg = JSON.parse(data.toString());
    msg.ts = Date.now();

    history.push(msg);

    // Save compressed history
    const serialized =
      history.map(m => JSON.stringify(m)).join("\n") + "\n";

    const compressed = zlib.gzipSync(serialized);
    fs.writeFileSync(LOG_FILE, compressed);

    broadcast(JSON.stringify(msg));
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast({ system: true, msg: "Someone disconnected." });
  });
});

function broadcast(message) {
  const payload = typeof message === "string"
    ? message
    : JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// ─── Start server ─────────────────────────────────────────
server.listen(25565, () => {
  console.log("Secure chat running at https://localhost:25565");
});


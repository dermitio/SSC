import https from "https";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { handleFileRequest } from "./fileserver.js";
import { lookup } from "mime-types";
import { handleAudioRequest } from "./audioserver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const distDir = path.join(__dirname, "dist");
const TURN_PORT = Number(process.env.TURN_PORT || 25510);
const TURN_TLS_PORT = Number(process.env.TURN_TLS_PORT || 25511);
const TURN_RELAY_MIN_PORT = Number(process.env.TURN_RELAY_MIN_PORT || 25512);
const TURN_RELAY_MAX_PORT = Number(process.env.TURN_RELAY_MAX_PORT || 25520);
const TURN_TTL_SECONDS = Number(process.env.TURN_TTL_SECONDS || 3600);
const TURN_RELAY_ONLY = process.env.TURN_RELAY_ONLY !== "false";
const TURN_ENABLE_STUN = process.env.TURN_ENABLE_STUN === "true";
const TURN_ENABLE_TCP = process.env.TURN_ENABLE_TCP === "true";

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
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function staticDir() {
  return fs.existsSync(path.join(distDir, "index.html")) ? distDir : publicDir;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function requestHost(req) {
  const rawHost = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return rawHost.toString().replace(/^\[/, "").replace(/\]$/, "").split(":")[0];
}

function isLocalHost(host) {
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
}

function turnHost(req) {
  const host = requestHost(req);
  const configured = process.env.TURN_HOST;

  if (!configured) return host;
  if (isLocalHost(configured) && !isLocalHost(host)) return host;

  return configured;
}

function turnHosts(req) {
  const primary = turnHost(req);
  const alternates = (process.env.TURN_ALT_HOSTS || "")
    .split(",")
    .map(host => host.trim())
    .filter(Boolean);

  return [...new Set([primary, ...alternates])];
}

function makeTurnCredentials(req) {
  const hosts = turnHosts(req);
  const realm = process.env.TURN_REALM || hosts[0];
  const urls = hosts.flatMap(host => {
    const hostUrls = [`turn:${host}:${TURN_PORT}?transport=udp`];

    if (TURN_ENABLE_STUN) {
      hostUrls.unshift(`stun:${host}:${TURN_PORT}`);
    }

    if (TURN_ENABLE_TCP) {
      hostUrls.push(`turn:${host}:${TURN_PORT}?transport=tcp`);
    }

    return hostUrls;
  });

  if (process.env.TURN_ENABLE_TLS === "true") {
    urls.push(...hosts.map(host => `turns:${host}:${TURN_TLS_PORT}?transport=tcp`));
  }

  if (process.env.TURN_SECRET) {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
    const username = `${expiresAt}:guest`;
    const credential = crypto
      .createHmac("sha1", process.env.TURN_SECRET)
      .update(username)
      .digest("base64");

    return { realm, urls, username, credential, ttl: TURN_TTL_SECONDS };
  }

  return {
    realm,
    urls,
    username: process.env.TURN_USERNAME || "chatuser",
    credential: process.env.TURN_PASSWORD || "change-this-long-random-secret",
    ttl: null
  };
}

// ─── HTTPS server ─────────────────────────────────────────
const server = https.createServer(tlsOpts, (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/turn-credentials") {
    sendJson(res, 200, {
      iceTransportPolicy: TURN_RELAY_ONLY ? "relay" : "all",
      iceServers: [makeTurnCredentials(req)],
      relayPorts: {
        min: TURN_RELAY_MIN_PORT,
        max: TURN_RELAY_MAX_PORT
      }
    });
    return;
  }

  // 1️⃣ File server FIRST
  if (handleFileRequest(req, res)) {
    return;
  }
  if (handleAudioRequest(req, res)) {
    return;
  }

  // 2️⃣ Static files (GET only)
  if (req.method === "GET") {
    const root = staticDir();
    const urlPath = decodeURIComponent(url.pathname);
    const safePath = path.normalize(path.join(root, urlPath));

    if (
      isInside(root, safePath) &&
      fs.existsSync(safePath) &&
      fs.statSync(safePath).isFile()
    ) {
      const type = lookup(safePath) || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // Fallback page
    const fallback = path.join(root, "index.html");
    if (!fs.existsSync(fallback)) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Frontend is not built. Run npm run build first.");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(fallback).pipe(res);
    return;
  }

  // 3️⃣ Anything else
  res.writeHead(404);
  res.end();
});

// ─── WebSocket server ─────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Map();

wss.on("connection", ws => {
  const client = {
    id: crypto.randomUUID(),
    name: "Guest"
  };
  clients.set(ws, client);

  ws.send(JSON.stringify({
    type: "client-ready",
    clientId: client.id
  }));
  ws.send(JSON.stringify({
    system: true,
    history
  }));

  broadcast({ system: true, msg: "Someone connected." });
  broadcastPresence();

  ws.on("message", data => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "presence-update") {
      client.name = cleanName(msg.name);
      broadcastPresence();
      return;
    }

    if (isCallSignal(msg)) {
      forwardToClient(msg.to, {
        ...msg,
        from: client.id,
        fromName: client.name
      });
      return;
    }

    if (!msg || typeof msg !== "object" || typeof msg.name !== "string") {
      return;
    }

    msg.name = cleanName(msg.name);
    client.name = msg.name;
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
    broadcastPresence();
  });
});

function cleanName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return name.slice(0, 40) || "Guest";
}

function isCallSignal(message) {
  return [
    "call-offer",
    "call-answer",
    "ice-candidate",
    "call-hangup",
    "call-decline"
  ].includes(message.type) && typeof message.to === "string";
}

function forwardToClient(clientId, message) {
  const payload = JSON.stringify(message);

  for (const [socket, client] of clients) {
    if (client.id === clientId && socket.readyState === 1) {
      socket.send(payload);
      return true;
    }
  }

  return false;
}

function broadcastPresence() {
  const participants = Array.from(clients.values()).map(client => ({
    id: client.id,
    name: client.name
  }));

  broadcast({
    type: "presence",
    participants
  });
}

function broadcast(message) {
  const payload = typeof message === "string"
    ? message
    : JSON.stringify(message);

  for (const socket of clients.keys()) {
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

// ─── Start server ─────────────────────────────────────────
const PORT = Number(process.env.PORT || 25564);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Simple Secure Chat running at https://localhost:${PORT}`);
});

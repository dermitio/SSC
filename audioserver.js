import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import { lookup } from "mime-types";

const AUDIO_DIR = "./public/audio";
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25 MB (~3–4 min opus)

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function sanitize(name) {
  return path.basename(name).replace(/[^\w.\-]/g, "_");
}

export function handleAudioRequest(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);

  // GET /audio/:filename
  if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
    const filename = sanitize(decodeURIComponent(url.pathname.slice("/audio/".length)));
    const target = path.join(AUDIO_DIR, filename);

    if (!filename || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404);
      res.end("Audio not found");
      return true;
    }

    res.writeHead(200, {
      "Content-Type": lookup(target) || "audio/webm",
      "Content-Length": fs.statSync(target).size
    });
    fs.createReadStream(target).pipe(res);
    return true;
  }

  // POST /audio/upload
  if (req.method === "POST" && url.pathname === "/audio/upload") {
    const filename = sanitize(url.searchParams.get("name") || "");

    if (!filename) {
      res.writeHead(400);
      res.end("Missing filename");
      return true;
    }

    const target = path.join(AUDIO_DIR, filename);
    if (fs.existsSync(target)) {
      res.writeHead(409);
      res.end("Audio already exists");
      return true;
    }

    const length = Number(req.headers["content-length"] || 0);
    if (length > MAX_AUDIO_SIZE) {
      res.writeHead(413);
      res.end("Audio too large");
      return true;
    }

    const out = fs.createWriteStream(target, { flags: "wx" });

    pipeline(req, out, err => {
      if (err) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Audio upload failed");
        }
        fs.existsSync(target) && fs.unlinkSync(target);
      } else {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ filename }));
      }
    });

    return true;
  }

  return false;
}

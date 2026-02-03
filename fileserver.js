import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import { Transform } from "stream";

const FILE_DIR = "./public/files";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 200 * 1024 * 1024;

if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, { recursive: true });
}

// ─── Size limiter stream ─────────────────────────────────
class SizeLimit extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.total = 0;
  }

  _transform(chunk, enc, cb) {
    this.total += chunk.length;
    if (this.total > this.limit) {
      cb(new Error("File too large"));
    } else {
      cb(null, chunk);
    }
  }
}

function deleteOldestFile() {
  const files = fs.readdirSync(FILE_DIR)
    .map(name => {
      const full = path.join(FILE_DIR, name);
      return {
        name,
        time: fs.statSync(full).mtimeMs
      };
    })
    .sort((a, b) => a.time - b.time); // oldest first

  if (files.length > 0) {
    const oldest = path.join(FILE_DIR, files[0].name);
    fs.unlinkSync(oldest);
    console.log("Deleted oldest file:", files[0].name);
  }
}

// ─── Helpers ─────────────────────────────────────────────
function sanitize(name) {
  return path.basename(name).replace(/[^\w.\-]/g, "_");
}

function listFiles() {
  return fs.readdirSync(FILE_DIR).filter(f =>
    fs.statSync(path.join(FILE_DIR, f)).isFile()
  );
}

// ─── Main handler ────────────────────────────────────────
export function handleFileRequest(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);

  // GET /files → list
  if (req.method === "GET" && url.pathname === "/files") {
    const files = listFiles();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(files));
    return true;
  }

  // POST /files/upload
  if (req.method === "POST" && url.pathname === "/files/upload") {
    const filename = sanitize(url.searchParams.get("name") || "");

    if (!filename) {
      res.writeHead(400);
      res.end("Missing filename");
      return true;
    }

const files = listFiles();
if (files.length >= MAX_FILES) {
  deleteOldestFile();
}


    const target = path.join(FILE_DIR, filename);
    if (fs.existsSync(target)) {
      res.writeHead(409);
      res.end("File already exists");
      return true;
    }

    const limiter = new SizeLimit(MAX_FILE_SIZE);
    const out = fs.createWriteStream(target, { flags: "wx" });

    pipeline(req, limiter, out, err => {
      if (err) {
        if (!res.headersSent) {
          res.writeHead(err.message === "File too large" ? 413 : 500);
          res.end(err.message);
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


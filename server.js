// Servidor local para testar: serve a pasta public/ e a rota /api/claude.
// Uso: npm run dev (lê .env se existir) e abra http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import handler from "./api/claude.js";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = new URL("./public/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
};

function wrap(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/claude") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = null; }
    return handler(req, wrap(res));
  }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(path);
    res.setHeader("content-type", TYPES[extname(path)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404; res.end("Não encontrado");
  }
}).listen(PORT, () => console.log(`Encarregado de Obras em http://localhost:${PORT}`));

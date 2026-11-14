// Serves the built corporate site (dist/) with security headers. Run `npm run build`, then `npm start`.
//   PORT        port to listen on (default 3000; Railway sets it)
//   IMG_ORIGINS extra origins images may load from, space separated. Default: any https.
// No dependencies, so it also works on a plain Node image. Unlike the shop, this is a plain site: an unknown address is a real 404.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".xml"]);

/** The Content-Security-Policy for the site. Scripts and styles from our own origin only. */
export function csp({ imgOrigins = "" } = {}) {
  const img = imgOrigins.trim() ? `'self' data: ${imgOrigins.trim()}` : "'self' data: https:";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src ${img}`,
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(opts) {
  return {
    "Content-Security-Policy": csp(opts),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

function resolveFile(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.normalize(path.join(root, clean));
  if (!target.startsWith(root)) return null; // path traversal
  for (const candidate of [target, path.join(target, "index.html")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function makeServer({ root, imgOrigins = "" }) {
  const base = path.resolve(root);
  const headers = securityHeaders({ imgOrigins });
  return createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", ...headers });
      return res.end();
    }
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain", ...headers });
      return res.end("ok");
    }
    let file;
    try {
      file = resolveFile(base, req.url ?? "/");
    } catch {
      res.writeHead(400, headers);
      return res.end();
    }
    let status = 200;
    if (!file) {
      // Unknown address: send the site's own 404 page with a real 404 status, so search engines drop it.
      const missing = path.join(base, "404.html");
      status = 404;
      if (!existsSync(missing) || path.extname((req.url ?? "").split("?")[0])) {
        res.writeHead(404, { "Content-Type": "text/plain", ...headers });
        return res.end("Not found");
      }
      file = missing;
    }
    const ext = path.extname(file);
    const isFont = ext === ".woff2";
    const out = {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": isFont ? "public, max-age=604800" : "no-cache",
      ...headers,
    };
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    if (gzip) {
      out["Content-Encoding"] = "gzip";
      out.Vary = "Accept-Encoding";
    }
    res.writeHead(status, out);
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(file);
    (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
  makeServer({ root, imgOrigins: process.env.IMG_ORIGINS || "" }).listen(port, "0.0.0.0", () => console.log(`Serving ${root} on :${port}`));
}

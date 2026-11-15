// The corporate website. Pages are rendered on request from the Mpanko API (cached for a minute), with built-in fallback
// wording if the API is not configured or cannot be reached. No browser JavaScript; the contact form is a plain form post.
//   PORT          port to listen on (default 3000; Railway sets it)
//   API_URL       the Mpanko API's address, for example https://api.example.com (server to server; the browser never calls it)
//   SITE_URL      this site's own address, for canonical links and the sitemap
//   SHOP_URL      optional: the shop's address, for the policy links in the footer
//   IMG_ORIGINS   extra origins images may load from, space separated. Default: any https.
// No dependencies, so it also works on a plain Node image.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { createApi } from "./src/api.mjs";
import { fallbackBusinesses, fallbackProfile, site as envSite } from "./src/content.mjs";
import { aboutPage, contactPage, homePage, magaziaPage, menuPage, MENU_SLUG, notFoundPage, servicePage, servicesPage, sitemap, unavailablePage } from "./src/render.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
};
const COMPRESSIBLE = new Set([".html", ".css", ".svg", ".txt", ".xml"]);
const MAX_BODY = 20_000;

/** The Content-Security-Policy. Scripts and styles from our own origin only; the form may only post back to us. */
export function csp({ imgOrigins = "" } = {}) {
  const img = imgOrigins.trim() ? `'self' data: ${imgOrigins.trim()}` : "'self' data: https:";
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", `img-src ${img}`, "font-src 'self' data:", "connect-src 'none'",
    "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests",
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
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

/** The visitor's address as the proxy in front of us saw it: the last entry, which our own proxy added. */
export function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || "unknown";
}

/** At most `limit` posts per `windowMs` for each key. In memory, so it resets when the site restarts. */
export function createLimiter({ limit = 5, windowMs = 600_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now();
    for (const [k, list] of hits) {
      const fresh = list.filter((x) => t - x < windowMs);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
    const list = hits.get(key) || [];
    if (list.length >= limit) return false;
    hits.set(key, [...list, t]);
    return true;
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(values) {
  const errors = {};
  if (!values.name) errors.name = "Enter your name.";
  if (!EMAIL.test(values.email)) errors.email = "Enter a valid email address, such as name@example.com.";
  if (values.message.length < 10) errors.message = "Write a little more, at least 10 characters.";
  if (values.message.length > 4000) errors.message = "Keep the message under 4,000 characters.";
  return errors;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (over) return;
      if (size > MAX_BODY) { over = true; chunks.length = 0; } else chunks.push(c);
    });
    req.on("end", () => (over ? reject(new Error("too large")) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

export function makeServer({ root, apiUrl = envSite.apiUrl, siteUrl = envSite.url, shopUrl = envSite.shopUrl, imgOrigins = "", fetchImpl, limiter = createLimiter() }) {
  const base = path.resolve(root);
  const headers = securityHeaders({ imgOrigins });
  const api = createApi({ apiUrl, ...(fetchImpl ? { fetchImpl } : {}) });
  const site = { url: siteUrl, shopUrl };

  // Each contact detail: the one entered under Site details, else the shop's own setting. While developing, a
  // placeholder stands in so the layout can be checked; production shows nothing until a real one is set.
  const dev = process.env.NODE_ENV !== "production";
  const pick = (placeholder, ...candidates) => candidates.find((c) => c && String(c).trim()) || (dev ? placeholder : "");
  // Per kind: the profile's own entries, else the shop's list (or its single setting). A kind with nothing shows a placeholder in development only.
  const contactFrom = (profile, shop) => {
    const shopRows = Array.isArray(shop.contacts) ? shop.contacts.filter((c) => c && String(c.value || "").trim()) : [];
    const shopOf = (kind, single) => {
      const own = shopRows.filter((c) => c.kind === kind);
      return own.length ? own : single && String(single).trim() ? [{ kind, label: "", value: single }] : [];
    };
    const phones = [[profile.phone, profile.phone_label], [profile.phone_2, profile.phone_2_label]].filter(([n]) => n && String(n).trim()).map(([value, label]) => ({ kind: "phone", label: label || "", value }));
    const emails = profile.contact_email && String(profile.contact_email).trim() ? [{ kind: "email", label: "", value: profile.contact_email }] : shopOf("email", shop.support_email);
    const calls = phones.length ? phones : shopOf("phone", shop.support_phone);
    const chats = shopOf("whatsapp", shop.whatsapp_number);
    const rows = [...emails, ...calls, ...chats];
    if (!rows.length && dev) rows.push({ kind: "email", label: "", value: "help@mpanko.example" }, { kind: "phone", label: "", value: "+233 00 000 0000" }, { kind: "whatsapp", label: "", value: "233000000000" });
    return { ...profile, contacts: rows, contact_email: emails[0]?.value || "", phone: calls[0]?.value || "", whatsapp_number: chats[0]?.value || "" };
  };

  async function context() {
    const res = await api.site();
    if (res.status === "ok") {
      const pages = Object.fromEntries((res.data.pages || []).map((p) => [p.slug, p]));
      return { site, profile: contactFrom(res.data.profile, res.data), businesses: res.data.businesses, pages, gallery: res.data.gallery || [], live: true };
    }
    return { site, profile: contactFrom(fallbackProfile, { support_email: process.env.SUPPORT_EMAIL_ADDRESS, support_phone: process.env.SUPPORT_PHONE_NUMBER, whatsapp_number: process.env.WHATSAPP_SUPPORT_NUMBER }), businesses: fallbackBusinesses, pages: {}, gallery: [], live: false };
  }

  const send = (req, res, status, html, extra = {}) => {
    const out = { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache", ...headers, ...extra };
    const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    if (gzip) { out["Content-Encoding"] = "gzip"; out.Vary = "Accept-Encoding"; }
    res.writeHead(status, out);
    if (req.method === "HEAD") return res.end();
    if (gzip) { const z = createGzip(); z.pipe(res); z.end(html); } else res.end(html);
  };
  const redirect = (res, to, status = 303) => { res.writeHead(status, { Location: to, ...headers }); res.end(); };

  async function contactPost(req, res, ctx) {
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
      if (!ok) { res.writeHead(403, { "Content-Type": "text/plain", ...headers }); return res.end("Forbidden"); }
    }
    let raw;
    try { raw = await readBody(req); } catch { res.writeHead(413, { ...headers, Connection: "close" }); return res.end(); }
    const form = new URLSearchParams(raw);
    const get = (k, max) => String(form.get(k) ?? "").slice(0, max);
    const values = { name: get("name", 120).replace(/\s+/g, " ").trim(), email: get("email", 254).trim(), phone: get("phone", 40).trim(), business: get("business", 140).trim(), message: get("message", 5000).trim() };
    if (get("website", 200)) return redirect(res, "/contact?sent=1"); // a bot filled the hidden field: pretend it worked
    const errors = validateContact(values);
    if (Object.keys(errors).length) return send(req, res, 422, contactPage(ctx, { values, errors, notice: "Please fix the highlighted fields." }));
    if (!limiter(clientIp(req))) {
      return send(req, res, 429, contactPage(ctx, { values, notice: "You have sent several messages in a short time. Please wait a few minutes and try again." }));
    }
    const out = await api.contact(values);
    if (out.ok) return redirect(res, "/contact?sent=1");
    if (out.kind === "invalid") {
      const fieldErrors = {};
      for (const [k, v] of Object.entries(out.errors || {})) fieldErrors[k] = Array.isArray(v) ? String(v[0]) : String(v);
      return send(req, res, 422, contactPage(ctx, { values, errors: fieldErrors, notice: "Please fix the highlighted fields." }));
    }
    const mail = ctx.profile.contact_email ? ` You can also email us at ${ctx.profile.contact_email}.` : "";
    const busy = out.kind === "busy";
    return send(req, res, busy ? 429 : 503, contactPage(ctx, { values, notice: busy ? "We have had a lot of messages. Please try again in a few minutes." : `We could not send your message right now. Please try again shortly.${mail}` }));
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const p = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
      if (req.method === "POST" && p === "/contact") return await contactPost(req, res, await context());
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", ...headers });
        return res.end();
      }
      if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain", ...headers }); return res.end("ok"); }
      if (p === "/robots.txt") {
        res.writeHead(200, { "Content-Type": TYPES[".txt"], "Cache-Control": "no-cache", ...headers });
        return res.end(`User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ""}`);
      }
      if (p === "/sitemap.xml") {
        const ctx = await context();
        const xml = sitemap(site, ctx.businesses, ctx.pages);
        if (!xml) { res.writeHead(404, { "Content-Type": "text/plain", ...headers }); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": TYPES[".xml"], "Cache-Control": "no-cache", ...headers });
        return res.end(xml);
      }
      // Static files: stylesheet, fonts, icon.
      if (path.extname(p)) {
        let file = null;
        try { file = resolveFile(base, p); } catch { res.writeHead(400, headers); return res.end(); }
        if (!file || path.basename(file) === "index.html") { res.writeHead(404, { "Content-Type": "text/plain", ...headers }); return res.end("Not found"); }
        const ext = path.extname(file);
        const out = { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": ext === ".woff2" ? "public, max-age=604800" : "no-cache", ...headers };
        const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
        if (gzip) { out["Content-Encoding"] = "gzip"; out.Vary = "Accept-Encoding"; }
        res.writeHead(200, out);
        if (req.method === "HEAD") return res.end();
        const stream = createReadStream(file);
        return void (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
      }
      // Pages.
      const ctx = await context();
      if (p === "/") return send(req, res, 200, homePage(ctx));
      if (p === "/about") return send(req, res, 200, aboutPage(ctx));
      if (p === "/services") return send(req, res, 200, servicesPage(ctx));
      if (p === "/magazia") return ctx.pages.magazia ? send(req, res, 200, magaziaPage(ctx, ctx.pages.magazia)) : send(req, res, 404, notFoundPage(ctx));
      if (p === "/menu") {
        if (!ctx.businesses.some((b) => b.slug === MENU_SLUG)) return send(req, res, 404, notFoundPage(ctx));
        const found = await api.menu(MENU_SLUG);
        if (found.status === "ok") return send(req, res, 200, menuPage(ctx, found.data));
        return send(req, res, found.status === "missing" ? 404 : 503, found.status === "missing" ? notFoundPage(ctx) : unavailablePage(ctx));
      }
      // The old address for the list of services keeps working.
      if (p === "/businesses") return redirect(res, "/services", 301);
      if (p === "/contact") {
        const want = url.searchParams.get("business") || "";
        const values = ctx.businesses.some((b) => b.slug === want) ? { business: want } : {};
        return send(req, res, 200, contactPage(ctx, url.searchParams.get("sent") === "1" ? { state: "sent" } : { values }));
      }
      const old = p.match(/^\/businesses\/([^/]+)$/);
      if (old) return redirect(res, `/services/${old[1]}`, 301);
      const m = p.match(/^\/services\/([^/]+)$/);
      if (m) {
        const slug = decodeURIComponent(m[1]);
        const found = await api.business(slug);
        if (found.status === "ok") return send(req, res, 200, servicePage(ctx, found.data));
        if (found.status === "missing") return send(req, res, 404, notFoundPage(ctx));
        const fb = !ctx.live ? fallbackBusinesses.find((b) => b.slug === slug) : null;
        if (fb) return send(req, res, 200, servicePage(ctx, fb));
        return send(req, res, ctx.live ? 503 : 404, ctx.live ? unavailablePage(ctx) : notFoundPage(ctx));
      }
      return send(req, res, 404, notFoundPage(ctx));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain", ...headers });
      res.end("Something went wrong.");
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
  if (!envSite.apiUrl) console.warn("API_URL is not set: the site will show its built-in wording, not your businesses. Set it to the API's address.");
  makeServer({ root, imgOrigins: process.env.IMG_ORIGINS || "" }).listen(port, "0.0.0.0", () => console.log(`Serving ${root} on :${port}`));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "./build.mjs";
import { clientIp, createLimiter, makeServer, validateContact } from "../server.mjs";
import { createApi } from "../src/api.mjs";

const PROFILE = { company_name: "Wolbi Group", tagline: "Many businesses, one name.", intro: "Intro text.", about: "About one.\n\nAbout two.", contact_email: "hi@wolbi.example", phone: "", address: "", linkedin_url: "", instagram_url: "", facebook_url: "", x_url: "" };
const FOODS = { slug: "wolbi-foods", name: "Wolbi Foods", sector: "Food", tagline: "Good food.", summary: "Pantry goods.", description: "Para one.", location: "Tamale", website_url: "https://foods.example.org", logo: "", logo_alt: "", is_featured: true };

/** A fake API. `state.mode` switches it between working, down and slow-to-fail; `state.posts` records contact messages. */
function fakeApi(state) {
  return async (url, opts = {}) => {
    state.calls.push(`${opts.method || "GET"} ${url}`);
    if (state.mode === "down") throw new Error("connection refused");
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/corporate/site/")) return json(200, { profile: PROFILE, businesses: state.businesses });
    if (url.includes("/corporate/businesses/")) {
      const slug = decodeURIComponent(url.split("/corporate/businesses/")[1].replace(/\/$/, ""));
      const b = state.businesses.find((x) => x.slug === slug);
      return b ? json(200, b) : json(404, { detail: "Not found." });
    }
    if (url.endsWith("/corporate/contact/")) {
      state.posts.push(JSON.parse(opts.body));
      return state.contactReply ?? json(201, { ok: true });
    }
    return json(404, {});
  };
}

async function withServer(fn, { mode = "up", businesses = [FOODS], limiter, contactReply } = {}) {
  const dir = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"));
  const state = { mode, businesses, calls: [], posts: [], contactReply };
  const server = makeServer({ root: dir, apiUrl: "http://api.test", siteUrl: "https://www.example.org", fetchImpl: fakeApi(state), limiter });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, state); } finally { server.close(); }
}
const form = (o) => new URLSearchParams({ name: "Ama Mensah", email: "ama@example.com", phone: "", business: "", message: "Do you ship to Canada, please?", website: "", ...o });
const post = (base, body, headers = {}) => fetch(base + "/contact", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body });

test("pages show what the API returns", () => withServer(async (base) => {
  const home = await (await fetch(base + "/")).text();
  assert.match(home, /Many businesses, one name\./);
  assert.match(home, /Wolbi Foods/);
  assert.match((await (await fetch(base + "/about")).text()), /About two\./);
  const b = await fetch(base + "/businesses/wolbi-foods");
  assert.equal(b.status, 200);
  assert.match(await b.text(), /Visit Wolbi Foods/);
}));

test("an unknown or unpublished business is a real 404; an unknown address too", () => withServer(async (base) => {
  assert.equal((await fetch(base + "/businesses/nope")).status, 404);
  assert.equal((await fetch(base + "/no/such/page")).status, 404);
  assert.match(await (await fetch(base + "/no/such/page")).text(), /We can't find that page/);
}));

test("when the API is down the site still shows the built-in wording", () => withServer(async (base) => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Rooted in Africa/);
  assert.match(html, /Mpanko shop/);
  assert.equal((await fetch(base + "/businesses/mpanko-shop")).status, 200);
  assert.equal((await fetch(base + "/businesses/wolbi-foods")).status, 404);
}, { mode: "down" }));

test("with no API address the site runs on its own wording", async () => {
  const dir = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"));
  const server = makeServer({ root: dir, apiUrl: "", siteUrl: "" });
  await new Promise((r) => server.listen(0, r));
  try { assert.match(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text(), /Mpanko shop/); } finally { server.close(); }
});

test("the API is asked once a minute, and the last answer is used if it then goes away", async () => {
  let t = 1_000_000;
  const state = { mode: "up", businesses: [FOODS], calls: [], posts: [] };
  const api = createApi({ apiUrl: "http://api.test", fetchImpl: fakeApi(state), now: () => t });
  assert.equal((await api.site()).status, "ok");
  assert.equal((await api.site()).status, "ok");
  assert.equal(state.calls.length, 1);
  t += 61_000;
  state.mode = "down";
  const stale = await api.site();
  assert.equal(stale.status, "ok");
  assert.equal(stale.data.businesses[0].name, "Wolbi Foods");
  assert.equal((await createApi({ apiUrl: "http://api.test", fetchImpl: fakeApi(state) }).site()).status, "down");
});

test("a valid message is passed to the API and the visitor is sent to a thank-you page", () => withServer(async (base, state) => {
  const r = await post(base, form({ business: "wolbi-foods" }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/contact?sent=1");
  assert.equal(state.posts.length, 1);
  assert.deepEqual([state.posts[0].name, state.posts[0].email, state.posts[0].business], ["Ama Mensah", "ama@example.com", "wolbi-foods"]);
  assert.match(await (await fetch(base + "/contact?sent=1")).text(), /Message sent/);
}));

test("mistakes are explained, the form keeps the answers, and nothing is sent", () => withServer(async (base, state) => {
  const r = await post(base, form({ email: "nope", message: "short" }));
  assert.equal(r.status, 422);
  const html = await r.text();
  assert.match(html, /Enter a valid email address/);
  assert.match(html, /at least 10 characters/);
  assert.match(html, /value="Ama Mensah"/);
  assert.equal(state.posts.length, 0);
}));

test("a filled hidden field is ignored without telling the bot", () => withServer(async (base, state) => {
  const r = await post(base, form({ website: "http://spam.example" }));
  assert.equal(r.status, 303);
  assert.equal(state.posts.length, 0);
}));

test("a post from another website is refused", () => withServer(async (base, state) => {
  assert.equal((await post(base, form(), { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post(base, form(), { Origin: base })).status, 303);
  assert.equal(state.posts.length, 1);
}));

test("too many messages from one visitor are slowed down", () => withServer(async (base, state) => {
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post(base, form(), { "X-Forwarded-For": "9.9.9.9" })).status);
  assert.deepEqual(codes, [303, 303, 429]);
  assert.equal((await post(base, form(), { "X-Forwarded-For": "8.8.8.8" })).status, 303);
  assert.equal(state.posts.length, 3);
}, { limiter: createLimiter({ limit: 2 }) }));

test("if the API cannot take the message the visitor is told and given another way to reach us", () => withServer(async (base) => {
  const r = await post(base, form());
  assert.equal(r.status, 503);
  const html = await r.text();
  assert.match(html, /could not send your message/);
  assert.match(html, /value="Ama Mensah"/);
}, { mode: "down" }));

test("API validation errors are shown beside the fields", () => withServer(async (base) => {
  const r = await post(base, form());
  assert.equal(r.status, 422);
  assert.match(await r.text(), /This email is blocked/);
}, { contactReply: new Response(JSON.stringify({ email: ["This email is blocked."] }), { status: 400 }) }));

test("an oversized post is refused", () => withServer(async (base) => {
  assert.equal((await post(base, "message=" + "x".repeat(30_000))).status, 413);
}));

test("static files, strict headers, sitemap, robots, health, methods and path traversal", () => withServer(async (base) => {
  const css = await fetch(base + "/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const f = await fetch(base + "/fonts/public-sans-latin-wght-normal.woff2");
  assert.equal(f.headers.get("content-type"), "font/woff2");
  const home = await fetch(base + "/");
  const csp = home.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  const sm = await (await fetch(base + "/sitemap.xml")).text();
  assert.ok(sm.includes("https://www.example.org/businesses/wolbi-foods<"));
  assert.match(await (await fetch(base + "/robots.txt")).text(), /Sitemap: https:\/\/www\.example\.org\/sitemap\.xml/);
  assert.equal(await (await fetch(base + "/healthz")).text(), "ok");
  assert.equal((await fetch(base + "/", { method: "DELETE" })).status, 405);
  assert.notEqual((await fetch(base + "/..%2f..%2fpackage.json")).status, 200);
  assert.equal((await fetch(base + "/index.html")).status, 404);
}));

test("helpers: visitor address, limiter and validation", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, socket: { remoteAddress: "9.9.9.9" } }), "2.2.2.2");
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "9.9.9.9" } }), "9.9.9.9");
  let t = 0;
  const lim = createLimiter({ limit: 1, windowMs: 100, now: () => t });
  assert.equal(lim("a"), true);
  assert.equal(lim("a"), false);
  t = 200;
  assert.equal(lim("a"), true);
  assert.deepEqual(validateContact({ name: "A", email: "a@b.co", message: "long enough message" }), {});
  assert.ok(validateContact({ name: "", email: "x", message: "y" }).name);
});

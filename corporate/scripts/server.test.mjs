import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "./build.mjs";
import { makeServer } from "../server.mjs";

async function withServer(fn) {
  const dir = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"));
  const server = makeServer({ root: dir });
  await new Promise((r) => server.listen(0, r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("the home page is served with strict security headers", () => withServer(async (base) => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
}));

test("an unknown address is a real 404 with the site's own page", () => withServer(async (base) => {
  const r = await fetch(base + "/no-such-page");
  assert.equal(r.status, 404);
  assert.match(await r.text(), /We can't find that page/);
  assert.equal((await fetch(base + "/missing.png")).status, 404);
}));

test("health check, fonts and path traversal", () => withServer(async (base) => {
  assert.equal(await (await fetch(base + "/healthz")).text(), "ok");
  const f = await fetch(base + "/fonts/public-sans-latin-wght-normal.woff2");
  assert.equal(f.status, 200);
  assert.equal(f.headers.get("content-type"), "font/woff2");
  assert.notEqual((await fetch(base + "/..%2f..%2fpackage.json")).status, 200);
}));

test("only GET and HEAD are allowed", () => withServer(async (base) => {
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
}));

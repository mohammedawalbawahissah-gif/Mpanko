// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { csp, makeServer } from "../server.mjs";

let server, base, siblingName;
beforeAll(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "site-"));
  mkdirSync(path.join(root, "assets"));
  mkdirSync(path.join(root, "shop", "kente"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), "<html>app</html>");
  writeFileSync(path.join(root, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(path.join(root, "shop", "kente", "index.html"), "<html>kente</html>");
  writeFileSync(path.join(root, "secret.txt"), "top");
  mkdirSync(`${root}-private`);
  writeFileSync(path.join(`${root}-private`, "key.txt"), "SECRET");
  siblingName = path.basename(root) + "-private";
  server = makeServer({ root: path.join(root, "."), apiOrigin: "https://api.example.com" });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

describe("static server", () => {
  it("sends the security headers on pages", async () => {
    const r = await fetch(base + "/");
    expect(r.status).toBe(200);
    const policy = r.headers.get("content-security-policy");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("permissions-policy")).toContain("camera=()");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
  });
  it("falls back to the app for page routes", async () => {
    const r = await fetch(base + "/orders/MP-1");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("app");
  });
  it("serves prerendered pages", async () => {
    expect(await (await fetch(base + "/shop/kente")).text()).toContain("kente");
  });
  it("caches hashed assets for a year but never the page", async () => {
    expect((await fetch(base + "/assets/app-abc.js")).headers.get("cache-control")).toContain("immutable");
    expect((await fetch(base + "/")).headers.get("cache-control")).toBe("no-cache");
  });
  it("returns 404 for a missing file", async () => {
    expect((await fetch(base + "/assets/nope.js")).status).toBe(404);
  });
  it("does not leave the site folder", async () => {
    const r = await fetch(base + "/..%2f..%2fetc/passwd");
    expect([200, 404]).toContain(r.status);
    expect(await r.text()).not.toContain("root:");
  });
  it("refuses writes", async () => {
    expect((await fetch(base + "/", { method: "POST" })).status).toBe(405);
  });
  it("has a health check", async () => {
    expect(await (await fetch(base + "/healthz")).text()).toBe("ok");
  });
  it("lets images come from the configured origins only", () => {
    expect(csp({ imgOrigins: "https://cdn.example.com" })).toContain("img-src 'self' data: https://cdn.example.com");
    expect(csp({})).toContain("img-src 'self' data: https:");
  });

  it("does not serve a sibling folder that shares the site folder's name prefix", async () => {
    const raw = (p) => new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: server.address().port, path: p, method: "GET" }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.end();
    });
    for (const p of [`/../${siblingName}/key.txt`, `/%2e%2e/${siblingName}/key.txt`, `/..%2f${siblingName}/key.txt`]) {
      expect(await raw(p), p).toBe(404);
    }
  });
});

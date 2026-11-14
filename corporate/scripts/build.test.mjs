import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, esc, renderPage } from "./build.mjs";
import * as content from "../src/content.mjs";

const html = renderPage(content);
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test("the page has one h1, a language, a title and a description", () => {
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<html lang="en">/);
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  assert.ok(title.length > 10 && title.length < 70, title);
  assert.match(html, /<meta name="description" content="[^"]{40,}/);
});

test("every in-page link points at a section that exists", () => {
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 5);
  for (const t of targets) assert.ok(ids.has(t), `missing #${t}`);
});

test("the page needs no scripts and no inline styles, so a strict security policy works", () => {
  assert.equal(/<script(?![^>]*application\/ld\+json)/.test(html), false);
  assert.equal(/\sstyle=/.test(html), false);
  assert.equal(/\son[a-z]+=/.test(html), false);
});

test("images, if any, have alt text", () => {
  for (const tag of html.match(/<img[^>]*>/g) || []) assert.match(tag, /\salt="/);
});

test("text from the content file is escaped", () => {
  assert.equal(esc(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
  const evil = { ...content, site: { ...content.site, name: "<script>x</script>" } };
  assert.equal(renderPage(evil).includes("<script>x"), false);
});

test("the build writes the site, fonts, 404 page and robots.txt", async () => {
  const out = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"));
  for (const f of ["index.html", "404.html", "styles.css", "favicon.svg", "robots.txt", "fonts/bricolage-grotesque-latin-wght-normal.woff2", "fonts/public-sans-latin-wght-normal.woff2"]) {
    assert.ok(existsSync(path.join(out, f)), f);
  }
  assert.match(readFileSync(path.join(out, "robots.txt"), "utf8"), /User-agent/);
});

test("the sitemap appears only when the domain is known", async () => {
  const withUrl = { ...content, site: { ...content.site, url: "https://example.org" } };
  const out = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"), withUrl);
  assert.match(readFileSync(path.join(out, "sitemap.xml"), "utf8"), /https:\/\/example\.org\//);
  assert.match(renderPage(withUrl), /rel="canonical" href="https:\/\/example\.org\/"/);
  const none = await build(path.join(mkdtempSync(path.join(os.tmpdir(), "corp-")), "dist"), content);
  assert.equal(existsSync(path.join(none, "sitemap.xml")), content.site.url !== "" ? true : false);
});

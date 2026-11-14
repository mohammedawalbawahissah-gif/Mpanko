// Builds dist/ from src/content.mjs and src/styles.css. No dependencies and no browser JavaScript.
//   node scripts/build.mjs [outDir]
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1b2455"/><path d="M12 50V14h8l12 20 12-20h8v36h-8V30L32 48 20 30v20z" fill="#c98e2b"/></svg>`;

export function renderPage(c) {
  const { site, nav, hero, about, sell, journey, contact, footer } = c;
  const canonical = site.url ? `<link rel="canonical" href="${esc(site.url)}/">` : "";
  const og = [
    ["og:type", "website"], ["og:title", `${site.name}: ${site.tagline}`], ["og:description", site.description],
    ...(site.url ? [["og:url", site.url + "/"]] : []),
  ].map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join("\n");
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "Organization", name: site.name, description: site.description,
    ...(site.url ? { url: site.url } : {}), email: site.email, ...(site.phone ? { telephone: site.phone } : {}),
  }).replace(/</g, "\\u003c");
  const contactRows = [
    ["Email", `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`],
    ...(site.phone ? [["Phone", `<a href="tel:${esc(site.phone.replace(/[^+\d]/g, ""))}">${esc(site.phone)}</a>`]] : []),
    ...(site.address ? [["Address", esc(site.address)]] : []),
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.name)}: ${esc(site.tagline)}</title>
<meta name="description" content="${esc(site.description)}">
<meta name="theme-color" content="#1b2455">
${canonical}
${og}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">${ld}</script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">${esc(site.name)}</a>
    <nav aria-label="Main">
      <ul>
${nav.map((n) => `        <li><a href="${esc(n.href)}">${esc(n.label)}</a></li>`).join("\n")}
      </ul>
    </nav>
  </div>
</header>
<main id="main">
  <div class="hero">
    <div class="hero-copy">
      <h1>${esc(hero.heading)}</h1>
      <p>${esc(hero.lead)}</p>
      <div class="actions">
        <a class="btn" href="${esc(site.shopUrl)}">Visit the shop</a>
        <a class="btn quiet" href="#contact">Talk to us</a>
      </div>
    </div>
    <div class="weave" aria-hidden="true"><div class="weave-cross"></div></div>
  </div>

  <section id="about" aria-labelledby="about-h">
    <div class="wrap">
      <h2 id="about-h">${esc(about.heading)}</h2>
      <div class="prose">
${about.paragraphs.map((p) => `        <p>${esc(p)}</p>`).join("\n")}
      </div>
    </div>
  </section>

  <section id="sell" aria-labelledby="sell-h">
    <div class="wrap">
      <div>
        <h2 id="sell-h">${esc(sell.heading)}</h2>
        <p class="lede">${esc(sell.intro)}</p>
      </div>
      <ul class="rows">
${sell.items.map((i) => `        <li><h3>${esc(i.name)}</h3><p>${esc(i.text)}</p></li>`).join("\n")}
      </ul>
    </div>
  </section>

  <section id="journey" class="band" aria-labelledby="journey-h">
    <div class="wrap">
      <div>
        <h2 id="journey-h">${esc(journey.heading)}</h2>
        <p class="lede">${esc(journey.intro)}</p>
      </div>
      <ol class="steps">
${journey.steps.map((s) => `        <li><h3>${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`).join("\n")}
      </ol>
    </div>
  </section>

  <section id="contact" class="contact" aria-labelledby="contact-h">
    <div class="wrap">
      <div>
        <h2 id="contact-h">${esc(contact.heading)}</h2>
        <p class="lede">${esc(contact.intro)}</p>
      </div>
      <div>
        <dl>${contactRows}</dl>
        <a class="btn" href="mailto:${esc(site.email)}">Email us</a>
      </div>
    </div>
  </section>
</main>
<footer>
  <div class="foot-inner">
    <p>&copy; ${new Date().getUTCFullYear()} ${esc(site.name)}</p>
    <nav aria-label="Shop and policies">
      <ul>
${footer.links.map((l) => `        <li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("\n")}
      </ul>
    </nav>
  </div>
</footer>
</body>
</html>
`;
}

export function render404(c) {
  const { site } = c;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found | ${esc(site.name)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top"><div class="top-inner"><a class="brand" href="/">${esc(site.name)}</a></div></header>
<main id="main">
  <section><div class="wrap"><div>
    <h1 class="page-title">We can't find that page</h1>
    <p class="lede">The address may be wrong or the page may have moved.</p>
    <p><a class="btn" href="/">Go to the home page</a></p>
  </div></div></section>
</main>
</body>
</html>
`;
}

export async function build(outDir = path.join(root, "dist"), content) {
  const c = content ?? (await import(pathToFileURL(path.join(root, "src", "content.mjs")).href));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "fonts"), { recursive: true });
  writeFileSync(path.join(outDir, "index.html"), renderPage(c));
  writeFileSync(path.join(outDir, "404.html"), render404(c));
  copyFileSync(path.join(root, "src", "styles.css"), path.join(outDir, "styles.css"));
  writeFileSync(path.join(outDir, "favicon.svg"), FAVICON);
  for (const [pkg, file] of [["bricolage-grotesque", "bricolage-grotesque-latin-wght-normal.woff2"], ["public-sans", "public-sans-latin-wght-normal.woff2"]]) {
    copyFileSync(path.join(root, "node_modules", "@fontsource-variable", pkg, "files", file), path.join(outDir, "fonts", file));
  }
  const base = c.site.url;
  writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ""}`);
  if (base) writeFileSync(path.join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(base)}/</loc></url></urlset>\n`);
  return outDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = await build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  const { PLACEHOLDERS } = await import(pathToFileURL(path.join(root, "src", "content.mjs")).href);
  console.log(`Built ${out}`);
  console.log("\nStill to come from the client:");
  for (const p of PLACEHOLDERS) console.log(`  - ${p}`);
}

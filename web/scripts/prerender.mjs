// Runs after `vite build`. Fetches the public catalog and writes, into dist/:
//   shop/<slug>/index.html   the app shell plus title, description, canonical, social tags, JSON-LD and readable text
//   sitemap.xml, robots.txt
// If the API is unreachable the build still succeeds (the app works, it just isn't prerendered).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API = (process.env.VITE_API_URL || "http://localhost:8000/api/v1").replace(/\/$/, "");
const SITE = (process.env.SITE_URL || "http://localhost:5173").replace(/\/$/, "");
const dist = path.resolve("dist");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

async function getAll(url) {
  const out = [];
  let next = url;
  while (next && out.length < 5000) {
    const res = await fetch(next, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${next} -> ${res.status}`);
    const page = await res.json();
    out.push(...(page.results ?? page));
    next = page.next;
  }
  return out;
}

function shell(template, { title, description, canonical, image, jsonld, body }) {
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" /><meta property="og:site_name" content="Mpanko" />`,
    `<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" /><meta property="og:url" content="${esc(canonical)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" /><meta name="twitter:card" content="summary_large_image" />` : "",
    jsonld ? `<script type="application/ld+json">${json(jsonld)}</script>` : "",
  ].join("\n    ");
  return template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace("</head>", `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"></div>\n    <noscript>${body}</noscript>`);
}

async function main() {
  const template = await readFile(path.join(dist, "index.html"), "utf8");
  let products = [];
  try {
    products = await getAll(`${API}/products/`);
  } catch (e) {
    console.warn(`prerender: catalog not reachable (${e.message}); skipping product pages`);
  }
  const urls = [{ loc: `${SITE}/` }, { loc: `${SITE}/shop` }];
  for (const slug of ["privacy", "terms", "returns-policy", "cookies"]) urls.push({ loc: `${SITE}/${slug}` });

  for (const p of products) {
    const price = (p.variants?.find((v) => v.is_active) ?? p.variants?.[0])?.price ?? p.base_price;
    const image = p.images?.[0]?.image;
    const abs = image && image.startsWith("http") ? image : image ? new URL(image, API).toString() : undefined;
    const description = (p.description || `${p.name} by ${p.maker || "an African maker"}, made in ${p.origin_country || "Africa"}.`).replace(/\s+/g, " ").slice(0, 300);
    const canonical = `${SITE}/shop/${p.slug}`;
    const inStock = p.variants?.some((v) => v.is_active && v.in_stock);
    const html = shell(template, {
      title: `${p.name} · Mpanko`, description, canonical, image: abs,
      jsonld: {
        "@context": "https://schema.org", "@type": "Product", name: p.name, description, image: abs ? [abs] : undefined,
        sku: p.variants?.[0]?.sku, brand: p.maker ? { "@type": "Brand", name: p.maker } : undefined,
        offers: { "@type": "Offer", url: canonical, priceCurrency: p.currency, price, availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
      },
      body: `<h1>${esc(p.name)}</h1><p>${esc(description)}</p><p>${esc(p.currency)} ${esc(price)}</p>`,
    });
    const dir = path.join(dist, "shop", p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html);
    urls.push({ loc: canonical });
  }

  const shopHtml = shell(template, {
    title: "Shop African-made products · Mpanko", canonical: `${SITE}/shop`,
    description: "Textiles, beauty, home and fashion made by African makers, shipped worldwide with tracking.",
    body: `<h1>Shop</h1><ul>${products.map((p) => `<li><a href="/shop/${esc(p.slug)}">${esc(p.name)}</a></li>`).join("")}</ul>`,
  });
  await mkdir(path.join(dist, "shop"), { recursive: true });
  await writeFile(path.join(dist, "shop", "index.html"), shopHtml);

  const today = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(path.join(dist, "robots.txt"),
    `User-agent: *\nDisallow: /bag\nDisallow: /checkout\nDisallow: /orders\nDisallow: /account\nDisallow: /support\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`prerender: ${products.length} product pages, ${urls.length} sitemap entries`);
}

main().catch((e) => { console.warn("prerender failed:", e.message); });

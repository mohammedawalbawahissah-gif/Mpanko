// Turns data into HTML. Pure functions: no network, no files. Every value from the API or the environment is escaped,
// and links are limited to http(s), so a business name or address cannot inject markup or a javascript: link.

export function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Return the address if it is http(s), otherwise an empty string. */
export function safeUrl(value) {
  try {
    const u = new URL(String(value ?? ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

export function paragraphs(text) {
  return String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

const prose = (text) => paragraphs(text).map((p) => `<p>${esc(p)}</p>`).join("\n");

export function monogram(name) {
  return (String(name).trim().match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
}

const isCurrent = (path, href) => path === href || (href !== "/" && path.startsWith(href + "/"));

/** The tabs, like a company site's menu: About, Services (a drop-down of every service), Magazia when that page exists, the Shop, Contact. */
function navItems({ site, businesses, pages = {} }) {
  return [
    { label: "About", href: "/about" },
    { label: "Services", href: "/services", menu: businesses },
    ...(pages.magazia ? [{ label: "Magazia", href: "/magazia" }] : []),
    ...(site.shopUrl ? [{ label: "Shop", href: site.shopUrl, external: true }] : []),
    { label: "Contact", href: "/contact" },
  ];
}

const serviceHref = (b) => `/services/${encodeURIComponent(b.slug)}`;

function desktopNav(items, path) {
  return `<nav class="nav-desktop" aria-label="Main">
      <ul>
${items.map((n) => {
    if (n.menu) {
      return `        <li class="has-menu"><details class="dd"><summary${isCurrent(path, n.href) ? ' class="is-current"' : ""}>${n.label}</summary>
          <ul class="dd-panel">
            <li><a class="all" href="${n.href}">All services</a></li>
${n.menu.map((b) => `            <li><a href="${serviceHref(b)}"${path === serviceHref(b) ? ' aria-current="page"' : ""}>${esc(b.name)}</a></li>`).join("\n")}
          </ul></details></li>`;
    }
    return `        <li><a href="${esc(n.href)}"${n.external ? ' rel="noopener"' : ""}${isCurrent(path, n.href) ? ' aria-current="page"' : ""}>${n.label}</a></li>`;
  }).join("\n")}
      </ul>
    </nav>`;
}

function mobileNav(items, path) {
  return `<details class="nav-mobile"><summary>Menu</summary>
    <nav aria-label="Menu">
      <ul>
${items.map((n) => `        <li><a href="${esc(n.href)}"${n.external ? ' rel="noopener"' : ""}${isCurrent(path, n.href) ? ' aria-current="page"' : ""}>${n.label}</a>${n.menu && n.menu.length ? `
          <ul>
${n.menu.map((b) => `            <li><a href="${serviceHref(b)}">${esc(b.name)}</a></li>`).join("\n")}
          </ul>` : ""}</li>`).join("\n")}
      </ul>
    </nav></details>`;
}

const SOCIAL = [["linkedin_url", "LinkedIn"], ["instagram_url", "Instagram"], ["facebook_url", "Facebook"], ["x_url", "X"]];

function logoOf(b, size = "md") {
  const src = safeUrl(b.logo);
  if (src) return `<img class="logo ${size}" src="${esc(src)}" alt="${esc(b.logo_alt || `${b.name} logo`)}" width="64" height="64" loading="lazy">`;
  return `<span class="logo ${size} mono" aria-hidden="true">${esc(monogram(b.name))}</span>`;
}

function businessRows(businesses) {
  return `<ul class="rows biz">
${businesses.map((b) => `    <li>
      ${logoOf(b)}
      <div>
        <h3><a class="stretch" href="${serviceHref(b)}">${esc(b.name)}</a></h3>
        ${b.sector || b.location ? `<p class="meta">${esc([b.sector, b.location].filter(Boolean).join(", "))}</p>` : ""}
        <p>${esc(b.summary)}</p>
      </div>
    </li>`).join("\n")}
  </ul>`;
}

const noBusinesses = `<p class="empty">We are adding the details of our services. Please check back soon, or <a href="/contact">contact us</a>.</p>`;

export function layout({ site, profile, businesses, pages = {}, title, description, path, body, noindex = false, status = 200 }) {
  const name = profile.company_name;
  const canonical = site.url && !noindex ? `<link rel="canonical" href="${esc(site.url + (path === "/" ? "/" : path))}">` : "";
  const fullTitle = path === "/" ? `${name}: ${profile.tagline}` : `${title} | ${name}`;
  const desc = description || profile.intro || profile.tagline;
  const og = [["og:type", "website"], ["og:title", fullTitle], ["og:description", desc], ...(site.url ? [["og:url", site.url + path]] : [])]
    .map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join("\n");
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "Organization", name, description: profile.intro || profile.tagline,
    ...(site.url ? { url: site.url } : {}), ...(profile.contact_email ? { email: profile.contact_email } : {}),
    ...(profile.phone ? { telephone: profile.phone_2 ? [profile.phone, profile.phone_2] : profile.phone } : {}),
    ...(businesses.length ? { subOrganization: businesses.map((b) => ({ "@type": "Organization", name: b.name, ...(safeUrl(b.website_url) ? { url: safeUrl(b.website_url) } : {}) })) } : {}),
  }).replace(/</g, "\\u003c");
  const social = SOCIAL.filter(([k]) => safeUrl(profile[k])).map(([k, l]) => `<li><a href="${esc(safeUrl(profile[k]))}" rel="noopener">${l}</a></li>`).join("");
  const policy = site.shopUrl
    ? [["Terms of sale", "/terms"], ["Privacy", "/privacy"], ["Returns", "/returns-policy"]].map(([l, p]) => `<li><a href="${esc(site.shopUrl + p)}">${l}</a></li>`).join("")
    : "";
  const items = navItems({ site, businesses, pages });
  const contactBits = [contactButtons(profile), profile.address ? `<p>${esc(profile.address)}</p>` : ""].filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0e7f74">
${noindex ? '<meta name="robots" content="noindex">' : ""}
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
    <a class="brand" href="/"><img src="/logo-light.svg" alt="${esc(name)}" width="92" height="68"></a>
    ${desktopNav(items, path)}
    <a class="btn get" href="/contact">Get in touch</a>
    ${mobileNav(items, path)}
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="foot-inner">
    <div>
      <p class="foot-name">&copy; ${new Date().getUTCFullYear()} ${esc(name)}</p>
      ${contactBits.join("")}
    </div>
    ${social || policy ? `<nav aria-label="More">
      <ul>${social}${policy}</ul>
    </nav>` : ""}
  </div>
</footer>
</body>
</html>
`;
}

const contactCta = (heading = "Talk to us") => `<section class="cta" aria-labelledby="cta-h">
    <div class="wrap">
      <h2 id="cta-h">${esc(heading)}</h2>
      <div><p class="lede">Questions, orders or working together? Send us a message and we will reply within two working days.</p>
      <p><a class="btn" href="/contact">Contact us</a></p></div>
    </div>
  </section>`;

const kv = (text) => (Array.isArray(text) ? text.map(String) : String(text ?? "").split("\n")).map((l) => l.trim()).filter(Boolean);

/** "2024 | Became Magazia" lines as a timeline. A line with no bar is shown without a year. */
function timeline(text) {
  const rows = kv(text).map((l) => { const i = l.indexOf("|"); return i > 0 ? { year: l.slice(0, i).trim(), text: l.slice(i + 1).trim() } : { year: "", text: l }; });
  return rows.length ? `<ol class="timeline">${rows.map((r) => `<li>${r.year ? `<span class="yr">${esc(r.year)}</span>` : ""}<span>${esc(r.text)}</span></li>`).join("")}</ol>` : "";
}

const ticks = (text) => { const rows = kv(text); return rows.length ? `<ul class="ticks">${rows.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""; };

function photo(src, alt, cls = "photo") {
  const url = safeUrl(src);
  return url ? `<figure class="${cls}"><img src="${esc(url)}" alt="${esc(alt || "")}" loading="lazy"></figure>` : "";
}

function founderSection(page) {
  if (!page) return "";
  return `<section id="founder" aria-labelledby="founder-h">
    <div class="wrap">
      <div>
        <h2 id="founder-h">${esc(page.title)}</h2>
        ${page.kicker ? `<p class="meta">${esc(page.kicker)}</p>` : ""}
        ${photo(page.image, page.image_alt || page.title, "photo portrait")}
      </div>
      <div class="prose">
        ${page.summary ? `<p class="lede big dark">${esc(page.summary)}</p>` : ""}
        ${prose(page.body)}
        ${page.quote ? `<figure class="pull"><blockquote><p>\u201c${esc(page.quote)}\u201d</p></blockquote><figcaption>${esc(page.quote_by || page.title)}</figcaption></figure>` : ""}
        ${page.highlights ? `<h3 class="mini">Milestones</h3>${timeline(page.highlights)}` : ""}
      </div>
    </div>
  </section>`;
}

export function homePage(ctx) {
  const { profile, businesses, pages = {} } = ctx;
  const first = paragraphs(profile.about)[0];
  const founder = pages.founder;
  const magazia = pages.magazia;
  const body = `<div class="hero">
    <div class="hero-copy">
      <h1>${esc(profile.tagline || profile.company_name)}</h1>
      ${profile.intro ? `<p>${esc(profile.intro)}</p>` : ""}
      <div class="actions">
        <a class="btn" href="/services">Our services</a>
        <a class="btn quiet" href="/contact">Get in touch</a>
      </div>
    </div>
    <div class="weave" aria-hidden="true"><div class="weave-cross"></div></div>
  </div>
  <section id="services" aria-labelledby="biz-h">
    <div class="wrap">
      <div>
        <h2 id="biz-h">Our services</h2>
        <p class="lede">${businesses.length > 1 ? "Food, fashion, events, beauty, insurance and a foundation, under one name." : "Where you can buy from us or work with us."}</p>
      </div>
      ${businesses.length ? businessRows(businesses) : noBusinesses}
    </div>
  </section>
  ${first ? `<section class="band" aria-labelledby="about-h">
    <div class="wrap">
      <h2 id="about-h">About Mpanko</h2>
      <div class="prose"><p>${esc(first)}</p><p><a class="textlink" href="/about">Read our story</a></p></div>
    </div>
  </section>` : ""}
  ${founder ? `<section aria-labelledby="meet-h">
    <div class="wrap">
      <div><h2 id="meet-h">${esc(founder.title)}</h2>${founder.kicker ? `<p class="meta">${esc(founder.kicker)}</p>` : ""}</div>
      <div class="prose"><p>${esc(founder.summary || paragraphs(founder.body)[0] || "")}</p><p><a class="textlink" href="/about#founder">Read Teefa's story</a></p></div>
    </div>
  </section>` : ""}
  ${magazia ? `<section class="heritage" aria-labelledby="mag-h">
    <div class="wrap">
      <div><h2 id="mag-h">${esc(magazia.title)}</h2>${magazia.kicker ? `<p class="meta">${esc(magazia.kicker)}</p>` : ""}</div>
      <div class="prose"><p>${esc(magazia.summary || paragraphs(magazia.body)[0] || "")}</p><p><a class="textlink" href="/magazia">About the title</a></p></div>
    </div>
  </section>` : ""}
  ${contactCta()}`;
  return layout({ ...ctx, title: "Home", path: "/", body });
}

export function aboutPage(ctx) {
  const { profile, businesses, pages = {} } = ctx;
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">About ${esc(profile.company_name)}</h1></div></section>
  <section aria-labelledby="who-h">
    <div class="wrap">
      <h2 id="who-h">Our story</h2>
      <div class="prose">${profile.about ? prose(profile.about) : "<p>We are adding this page. Please check back soon.</p>"}</div>
    </div>
  </section>
  ${businesses.length ? `<section class="band" aria-labelledby="what-h">
    <div class="wrap">
      <div><h2 id="what-h">What we run</h2><p class="lede"><a class="textlink" href="/services">See all services</a></p></div>
      <ul class="steps plain">${businesses.map((b) => `<li><h3><a href="${serviceHref(b)}">${esc(b.name)}</a></h3><p>${esc(b.tagline || b.summary)}</p></li>`).join("")}</ul>
    </div>
  </section>` : ""}
  ${founderSection(pages.founder)}
  ${pages.magazia ? `<section class="heritage" aria-labelledby="mag-h">
    <div class="wrap">
      <div><h2 id="mag-h">${esc(pages.magazia.title)}</h2>${pages.magazia.kicker ? `<p class="meta">${esc(pages.magazia.kicker)}</p>` : ""}</div>
      <div class="prose"><p>${esc(pages.magazia.summary || "")}</p><p><a class="textlink" href="/magazia">About the title</a></p></div>
    </div>
  </section>` : ""}
  ${contactCta()}`;
  return layout({ ...ctx, title: "About", path: "/about", description: paragraphs(profile.about)[0] || undefined, body });
}

export function servicesPage(ctx) {
  const { businesses } = ctx;
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">Services</h1></div></section>
  <section aria-labelledby="list-h">
    <div class="wrap">
      <div><h2 id="list-h" class="sr">All services</h2><p class="lede">Choose a service to see what it offers and how to reach it.</p></div>
      ${businesses.length ? businessRows(businesses) : noBusinesses}
    </div>
  </section>
  ${contactCta()}`;
  return layout({ ...ctx, title: "Services", path: "/services", description: "Everything we offer, from food and fashion to events, beauty, insurance and our foundation.", body });
}

/** The extra button on a service page: its own named button (Donate, Book now), going to its address or, with none, to the contact form about it. */
function serviceActions(b) {
  const contact = `/contact?business=${esc(encodeURIComponent(b.slug))}`;
  const site = safeUrl(b.website_url);
  const label = String(b.cta_label || "").trim();
  const ctaUrl = safeUrl(b.cta_url);
  const buttons = [];
  if (label) buttons.push(`<a class="btn" href="${ctaUrl ? esc(ctaUrl) : contact}"${ctaUrl ? ' rel="noopener"' : ""}>${esc(label)}</a>`);
  if (site) buttons.push(`<a class="btn${buttons.length ? " quiet dark" : ""}" href="${esc(site)}" rel="noopener">Visit ${esc(b.name)}</a>`);
  if (!label || ctaUrl) buttons.push(`<a class="btn${buttons.length ? " quiet dark" : ""}" href="${contact}">Ask about ${esc(b.name)}</a>`);
  return `<p class="actions">${buttons.join("\n          ")}</p>`;
}

export function servicePage(ctx, b) {
  const body = `<section class="page-head">
    <div class="wrap one">
      <p class="crumb"><a href="/services">Services</a></p>
      <div class="biz-head">
        ${logoOf(b, "lg")}
        <div>
          <h1 class="page-title">${esc(b.name)}</h1>
          ${b.sector || b.location ? `<p class="meta">${esc([b.sector, b.location].filter(Boolean).join(", "))}</p>` : ""}
        </div>
      </div>
      ${b.tagline ? `<p class="lede big">${esc(b.tagline)}</p>` : ""}
    </div>
  </section>
  <section aria-labelledby="what-h">
    <div class="wrap">
      <div>
        <h2 id="what-h">What it is</h2>
        ${photo(b.image, b.image_alt || b.name)}
        ${ticks(b.highlights)}
      </div>
      <div class="prose">
        ${prose(b.description || b.summary)}
        ${serviceActions(b)}
      </div>
    </div>
  </section>
  ${b.disclaimer ? `<section class="fine" aria-label="Important information"><div class="wrap one"><p>${esc(b.disclaimer)}</p></div></section>` : ""}`;
  return layout({ ...ctx, title: b.name, path: `/services/${b.slug}`, description: b.summary || b.tagline, body });
}

export function magaziaPage(ctx, page) {
  const body = `<section class="page-head">
    <div class="wrap one">
      ${page.kicker ? `<p class="crumb">${esc(page.kicker)}</p>` : ""}
      <h1 class="page-title">${esc(page.title)}</h1>
      ${page.summary ? `<p class="lede big">${esc(page.summary)}</p>` : ""}
    </div>
  </section>
  <section aria-labelledby="title-h">
    <div class="wrap">
      <div>
        <h2 id="title-h">At a glance</h2>
        ${photo(page.image, page.image_alt || page.title)}
        ${ticks(page.highlights)}
      </div>
      <div class="prose">
        ${prose(page.body)}
        ${page.quote ? `<figure class="pull"><blockquote><p>\u201c${esc(page.quote)}\u201d</p></blockquote><figcaption>${esc(page.quote_by || "")}</figcaption></figure>` : ""}
        <p class="actions"><a class="btn" href="/about#founder">Read Teefa's story</a><a class="btn quiet dark" href="/contact">Get in touch</a></p>
      </div>
    </div>
  </section>`;
  return layout({ ...ctx, title: page.title, path: "/magazia", description: page.summary || undefined, body });
}

/** Compact Email, Call and WhatsApp buttons with icons. They never show the address or number; each opens the right app. */
const CONTACT_ICONS = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.3-1.3-2-1-.8.8c-.8-.4-1.5-1.1-1.9-1.9l.8-.8-1-2z"/>',
};
const contactIcon = (k) => `<svg class="contact-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${CONTACT_ICONS[k]}</svg>`;
const KIND_NAME = { email: "Email", phone: "Call", whatsapp: "WhatsApp" };
const KIND_ICON = { email: "mail", phone: "call", whatsapp: "whatsapp" };
const KIND_ORDER = ["email", "phone", "whatsapp"];

/** The contacts to show, as [{ kind, label, value }]: the list the server sent, or built from the older single fields (email, two phones with names, WhatsApp). */
export function contactList(profile) {
  if (Array.isArray(profile.contacts)) return profile.contacts.filter((c) => c && String(c.value || "").trim());
  const rows = [];
  if (profile.contact_email) rows.push({ kind: "email", label: "", value: profile.contact_email });
  [[profile.phone, profile.phone_label], [profile.phone_2, profile.phone_2_label]].forEach(([value, label]) => { if (value && String(value).trim()) rows.push({ kind: "phone", label: label || "", value }); });
  if (profile.whatsapp_number) rows.push({ kind: "whatsapp", label: "", value: profile.whatsapp_number });
  return rows;
}

function chipHref(c) {
  if (c.kind === "email") return `mailto:${esc(String(c.value).trim())}`;
  if (c.kind === "whatsapp") return `https://wa.me/${esc(String(c.value).replace(/\D/g, ""))}`;
  return `tel:${esc(String(c.value).replace(/[^+\d]/g, ""))}`;
}

/** One button per contact, in the order Email, Call, WhatsApp. A contact with a name shows it; one without shows Email, Call or WhatsApp, numbered when there are several unnamed ones of that kind, so they can be told apart.
 * The kind is also spoken to screen readers. */
export function contactButtons(profile) {
  const rows = contactList(profile);
  const counts = {};
  rows.forEach((c) => { if (!String(c.label || "").trim()) counts[c.kind] = (counts[c.kind] || 0) + 1; });
  const seen = {};
  const chips = [...rows].sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind)).map((c) => {
    const label = String(c.label || "").trim();
    if (!label) seen[c.kind] = (seen[c.kind] || 0) + 1;
    const name = label || (counts[c.kind] > 1 ? `${KIND_NAME[c.kind]} ${seen[c.kind]}` : KIND_NAME[c.kind]);
    const hidden = label ? `<span class="sr-only"> (${KIND_NAME[c.kind]})</span>` : "";
    const ext = c.kind === "whatsapp" ? ' rel="noopener"' : "";
    return `<a class="contact-chip" href="${chipHref(c)}"${ext}>${contactIcon(KIND_ICON[c.kind])}${esc(name)}${hidden}</a>`;
  }).join("");
  return chips ? `<div class="contact-row">${chips}</div>` : "";
}

/** `form` is { values, errors, state: "idle"|"sent"|"error", notice } */
export function contactPage(ctx, form = {}) {
  const { profile, businesses } = ctx;
  const v = form.values || {};
  const errors = form.errors || {};
  const err = (f) => (errors[f] ? `<p class="field-error" id="${f}-err">${esc(errors[f])}</p>` : "");
  const attrs = (f) => (errors[f] ? ` aria-invalid="true" aria-describedby="${f}-err"` : "");
  const direct = contactButtons(profile) + (profile.address ? `<dl class="direct"><dt>Address</dt><dd>${esc(profile.address)}</dd></dl>` : "");
  const sent = form.state === "sent";
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">Contact us</h1></div></section>
  <section aria-labelledby="msg-h">
    <div class="wrap">
      <div>
        <h2 id="msg-h">Send a message</h2>
        <p class="lede">We reply within two working days.</p>
        ${direct}
      </div>
      <div>
        ${sent ? `<div class="notice ok" role="status"><h3>Message sent</h3><p>Thank you. We will reply by email within two working days.</p><p><a class="textlink" href="/">Back to the home page</a></p></div>` : `
        ${form.notice ? `<div class="notice bad" role="alert"><p>${esc(form.notice)}</p></div>` : ""}
        <form method="post" action="/contact" class="form" novalidate>
          <div class="field"><label for="name">Your name</label>${err("name")}<input id="name" name="name" autocomplete="name" required maxlength="120" value="${esc(v.name)}"${attrs("name")}></div>
          <div class="field"><label for="email">Email</label>${err("email")}<input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${esc(v.email)}"${attrs("email")}></div>
          <div class="field"><label for="phone">Phone (optional)</label>${err("phone")}<input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="40" value="${esc(v.phone)}"${attrs("phone")}></div>
          ${businesses.length ? `<div class="field"><label for="business">What is it about?</label>
            <select id="business" name="business">
              <option value="">The company in general</option>
              ${businesses.map((b) => `<option value="${esc(b.slug)}"${v.business === b.slug ? " selected" : ""}>${esc(b.name)}</option>`).join("")}
            </select></div>` : ""}
          <div class="field"><label for="message">Your message</label>${err("message")}<textarea id="message" name="message" rows="7" required minlength="10" maxlength="4000"${attrs("message")}>${esc(v.message)}</textarea></div>
          <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
          <p><button class="btn" type="submit">Send message</button></p>
        </form>`}
      </div>
    </div>
  </section>`;
  return layout({ ...ctx, title: "Contact us", path: "/contact", description: "Send us a message.", body, noindex: false });
}

export function notFoundPage(ctx) {
  const body = `<section class="page-head"><div class="wrap one"><h1 class="page-title">We can't find that page</h1>
    <p class="lede big">The address may be wrong, or the page may have moved.</p>
    <p><a class="btn" href="/">Go to the home page</a></p></div></section>`;
  return layout({ ...ctx, title: "Page not found", path: "/404", body, noindex: true });
}

export function unavailablePage(ctx) {
  const body = `<section class="page-head"><div class="wrap one"><h1 class="page-title">This page is not available right now</h1>
    <p class="lede big">Please try again in a few minutes.</p>
    <p><a class="btn" href="/">Go to the home page</a></p></div></section>`;
  return layout({ ...ctx, title: "Temporarily unavailable", path: "/unavailable", body, noindex: true });
}

export function sitemap(site, businesses, pages = {}) {
  if (!site.url) return "";
  const urls = ["/", "/about", "/services", ...(pages.magazia ? ["/magazia"] : []), "/contact", ...businesses.map((b) => `/services/${encodeURIComponent(b.slug)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(site.url + u)}</loc></url>`).join("")}</urlset>\n`;
}

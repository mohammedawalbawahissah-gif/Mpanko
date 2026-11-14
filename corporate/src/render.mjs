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

const NAV = [
  { label: "About", href: "/about" },
  { label: "Businesses", href: "/businesses" },
  { label: "Contact", href: "/contact" },
];

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
        <h3><a class="stretch" href="/businesses/${esc(encodeURIComponent(b.slug))}">${esc(b.name)}</a></h3>
        ${b.sector || b.location ? `<p class="meta">${esc([b.sector, b.location].filter(Boolean).join(", "))}</p>` : ""}
        <p>${esc(b.summary)}</p>
      </div>
    </li>`).join("\n")}
  </ul>`;
}

const noBusinesses = `<p class="empty">We are adding the details of our businesses. Please check back soon, or <a href="/contact">contact us</a>.</p>`;

export function layout({ site, profile, businesses, title, description, path, body, noindex = false, status = 200 }) {
  const name = profile.company_name;
  const canonical = site.url && !noindex ? `<link rel="canonical" href="${esc(site.url + (path === "/" ? "/" : path))}">` : "";
  const fullTitle = path === "/" ? `${name}: ${profile.tagline}` : `${title} | ${name}`;
  const desc = description || profile.intro || profile.tagline;
  const og = [["og:type", "website"], ["og:title", fullTitle], ["og:description", desc], ...(site.url ? [["og:url", site.url + path]] : [])]
    .map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join("\n");
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "Organization", name, description: profile.intro || profile.tagline,
    ...(site.url ? { url: site.url } : {}), ...(profile.contact_email ? { email: profile.contact_email } : {}),
    ...(profile.phone ? { telephone: profile.phone } : {}),
    ...(businesses.length ? { subOrganization: businesses.map((b) => ({ "@type": "Organization", name: b.name, ...(safeUrl(b.website_url) ? { url: safeUrl(b.website_url) } : {}) })) } : {}),
  }).replace(/</g, "\\u003c");
  const social = SOCIAL.filter(([k]) => safeUrl(profile[k])).map(([k, l]) => `<li><a href="${esc(safeUrl(profile[k]))}" rel="noopener">${l}</a></li>`).join("");
  const policy = site.shopUrl
    ? [["Terms of sale", "/terms"], ["Privacy", "/privacy"], ["Returns", "/returns-policy"]].map(([l, p]) => `<li><a href="${esc(site.shopUrl + p)}">${l}</a></li>`).join("")
    : "";
  const contactBits = [
    profile.contact_email ? `<a href="mailto:${esc(profile.contact_email)}">${esc(profile.contact_email)}</a>` : "",
    profile.phone ? `<a href="tel:${esc(profile.phone.replace(/[^+\d]/g, ""))}">${esc(profile.phone)}</a>` : "",
    profile.whatsapp_number ? `<a href="https://wa.me/${esc(String(profile.whatsapp_number).replace(/\D/g, ""))}" rel="noopener">Chat on WhatsApp</a>` : "",
    profile.address ? esc(profile.address) : "",
  ].filter(Boolean);
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
    <nav aria-label="Main">
      <ul>
${NAV.map((n) => `        <li><a href="${n.href}"${path === n.href || (n.href !== "/" && path.startsWith(n.href + "/")) ? ' aria-current="page"' : ""}>${n.label}</a></li>`).join("\n")}
      </ul>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="foot-inner">
    <div>
      <p class="foot-name">&copy; ${new Date().getUTCFullYear()} ${esc(name)}</p>
      ${contactBits.length ? `<p>${contactBits.join(" &middot; ")}</p>` : ""}
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

export function homePage(ctx) {
  const { profile, businesses } = ctx;
  const first = paragraphs(profile.about)[0];
  const body = `<div class="hero">
    <div class="hero-copy">
      <h1>${esc(profile.tagline || profile.company_name)}</h1>
      ${profile.intro ? `<p>${esc(profile.intro)}</p>` : ""}
      <div class="actions">
        <a class="btn" href="/businesses">Our businesses</a>
        <a class="btn quiet" href="/contact">Talk to us</a>
      </div>
    </div>
    <div class="weave" aria-hidden="true"><div class="weave-cross"></div></div>
  </div>
  <section id="businesses" aria-labelledby="biz-h">
    <div class="wrap">
      <div>
        <h2 id="biz-h">Our businesses</h2>
        <p class="lede">${businesses.length > 1 ? "Each one runs on its own, under one name." : "Where you can buy from us or work with us."}</p>
      </div>
      ${businesses.length ? businessRows(businesses) : noBusinesses}
    </div>
  </section>
  ${first ? `<section class="band" aria-labelledby="about-h">
    <div class="wrap">
      <h2 id="about-h">About us</h2>
      <div class="prose"><p>${esc(first)}</p><p><a class="textlink" href="/about">More about us</a></p></div>
    </div>
  </section>` : ""}
  ${contactCta()}`;
  return layout({ ...ctx, title: "Home", path: "/", body });
}

export function aboutPage(ctx) {
  const { profile, businesses } = ctx;
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">About us</h1></div></section>
  <section aria-labelledby="who-h">
    <div class="wrap">
      <h2 id="who-h">Who we are</h2>
      <div class="prose">${profile.about ? prose(profile.about) : "<p>We are adding this page. Please check back soon.</p>"}</div>
    </div>
  </section>
  ${businesses.length ? `<section class="band" aria-labelledby="what-h">
    <div class="wrap">
      <div><h2 id="what-h">What we run</h2><p class="lede"><a class="textlink" href="/businesses">See all businesses</a></p></div>
      <ul class="steps plain">${businesses.map((b) => `<li><h3><a href="/businesses/${esc(encodeURIComponent(b.slug))}">${esc(b.name)}</a></h3><p>${esc(b.tagline || b.summary)}</p></li>`).join("")}</ul>
    </div>
  </section>` : ""}
  ${contactCta()}`;
  return layout({ ...ctx, title: "About us", path: "/about", description: paragraphs(profile.about)[0] || undefined, body });
}

export function businessesPage(ctx) {
  const { businesses } = ctx;
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">Our businesses</h1></div></section>
  <section aria-labelledby="list-h">
    <div class="wrap">
      <div><h2 id="list-h" class="sr">All businesses</h2><p class="lede">Choose a business to see what it does and how to reach it.</p></div>
      ${businesses.length ? businessRows(businesses) : noBusinesses}
    </div>
  </section>
  ${contactCta()}`;
  return layout({ ...ctx, title: "Our businesses", path: "/businesses", description: "The businesses we run.", body });
}

export function businessPage(ctx, b) {
  const url = safeUrl(b.website_url);
  const body = `<section class="page-head">
    <div class="wrap one">
      <p class="crumb"><a href="/businesses">Our businesses</a></p>
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
      <h2 id="what-h">What it does</h2>
      <div class="prose">
        ${prose(b.description || b.summary)}
        <p class="actions">
          ${url ? `<a class="btn" href="${esc(url)}" rel="noopener">Visit ${esc(b.name)}</a>` : ""}
          <a class="btn ${url ? "quiet dark" : ""}" href="/contact?business=${esc(encodeURIComponent(b.slug))}">Ask about ${esc(b.name)}</a>
        </p>
      </div>
    </div>
  </section>`;
  return layout({ ...ctx, title: b.name, path: `/businesses/${b.slug}`, description: b.summary || b.tagline, body });
}

/** `form` is { values, errors, state: "idle"|"sent"|"error", notice } */
export function contactPage(ctx, form = {}) {
  const { profile, businesses } = ctx;
  const v = form.values || {};
  const errors = form.errors || {};
  const err = (f) => (errors[f] ? `<p class="field-error" id="${f}-err">${esc(errors[f])}</p>` : "");
  const attrs = (f) => (errors[f] ? ` aria-invalid="true" aria-describedby="${f}-err"` : "");
  const direct = [
    profile.contact_email ? `<dt>Email</dt><dd><a href="mailto:${esc(profile.contact_email)}">${esc(profile.contact_email)}</a></dd>` : "",
    profile.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(profile.phone.replace(/[^+\d]/g, ""))}">${esc(profile.phone)}</a></dd>` : "",
    profile.whatsapp_number ? `<dt>WhatsApp</dt><dd><a href="https://wa.me/${esc(String(profile.whatsapp_number).replace(/\D/g, ""))}" rel="noopener">Chat on WhatsApp</a></dd>` : "",
    profile.address ? `<dt>Address</dt><dd>${esc(profile.address)}</dd>` : "",
  ].join("");
  const sent = form.state === "sent";
  const body = `<section class="page-head"><div class="wrap"><h1 class="page-title">Contact us</h1></div></section>
  <section aria-labelledby="msg-h">
    <div class="wrap">
      <div>
        <h2 id="msg-h">Send a message</h2>
        <p class="lede">We reply within two working days.</p>
        ${direct ? `<dl class="direct">${direct}</dl>` : ""}
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

export function sitemap(site, businesses) {
  if (!site.url) return "";
  const urls = ["/", "/about", "/businesses", "/contact", ...businesses.map((b) => `/businesses/${encodeURIComponent(b.slug)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(site.url + u)}</loc></url>`).join("")}</urlset>\n`;
}

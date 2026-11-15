import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutPage, servicePage, servicesPage, magaziaPage, contactPage, esc, homePage, monogram, notFoundPage, paragraphs, safeUrl, sitemap } from "../src/render.mjs";
import { fallbackBusinesses, fallbackProfile } from "../src/content.mjs";

const site = { url: "https://www.example.org", shopUrl: "https://shop.example.org" };
const biz = (o = {}) => ({ slug: "wolbi-foods", name: "Wolbi Foods", sector: "Food", location: "Tamale", tagline: "Good food.", summary: "Pantry goods.", description: "One.\n\nTwo.", website_url: "https://foods.example.org", logo: "", logo_alt: "", is_featured: false, ...o });
const ctx = (businesses = [biz()], profile = fallbackProfile) => ({ site, profile, businesses });
const pages = (c) => ({
  home: homePage(c), about: aboutPage(c), services: servicesPage(c), service: servicePage(c, c.businesses[0] ?? biz()), magazia: magaziaPage(c, MAG), contact: contactPage(c), notFound: notFoundPage(c),
});
const MAG = { slug: "magazia", title: "Magazia", kicker: "A title of honour", summary: "Summary.", body: "One.\n\nTwo.", quote: "", quote_by: "", highlights: "", image: "", image_alt: "" };
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test("every page has one h1, a language, a unique title and a description", () => {
  const all = pages(ctx());
  const titles = new Set();
  for (const [name, html] of Object.entries(all)) {
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${name}: h1`);
    assert.match(html, /<html lang="en">/, name);
    assert.match(html, /<meta name="description" content="[^"]{5,}/, name);
    titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
  }
  assert.equal(titles.size, Object.keys(all).length);
});

test("in-page links and form labels point at things that exist", () => {
  for (const [name, html] of Object.entries(pages(ctx()))) {
    const have = ids(html);
    for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(have.has(m[1]), `${name}: #${m[1]}`);
    for (const m of html.matchAll(/for="([^"]+)"/g)) assert.ok(have.has(m[1]), `${name}: label for ${m[1]}`);
    for (const m of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(have.has(m[1]), `${name}: labelledby ${m[1]}`);
  }
});

test("no scripts, inline styles or event handlers, so the strict security policy holds", () => {
  for (const [name, html] of Object.entries(pages(ctx()))) {
    assert.equal(/<script(?![^>]*application\/ld\+json)/.test(html), false, name);
    assert.equal(/\sstyle=/.test(html), false, name);
    assert.equal(/\son[a-z]+=/.test(html), false, name);
  }
});

test("text from the API cannot inject markup", () => {
  const evil = biz({ name: `<img src=x onerror=alert(1)>`, summary: `"><script>alert(1)</script>`, sector: "<b>", description: "<script>x</script>", slug: "a b" });
  const c = ctx([evil], { ...fallbackProfile, company_name: "<i>Co</i>", about: "<script>no</script>" });
  for (const [name, html] of Object.entries(pages(c))) {
    assert.equal(html.includes("<img src=x"), false, name);
    assert.equal(html.includes("<script>alert"), false, name);
    assert.equal(html.includes("<script>no"), false, name);
    assert.equal(html.includes("<i>Co"), false, name);
  }
});

test("only http and https links are ever output", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("notaurl"), "");
  assert.equal(safeUrl("https://a.example/x"), "https://a.example/x");
  const c = ctx([biz({ website_url: "javascript:alert(1)", logo: "javascript:alert(2)" })], { ...fallbackProfile, linkedin_url: "javascript:alert(3)", instagram_url: "https://instagram.com/x" });
  const all = Object.values(pages(c)).join("\n");
  assert.equal(/javascript:/i.test(all), false);
  assert.match(all, /instagram\.com\/x/);
});

test("a business with a link gets a Visit button, one without does not", () => {
  assert.match(servicePage(ctx(), biz()), /Visit Wolbi Foods/);
  assert.equal(/Visit Wolbi Foods/.test(servicePage(ctx(), biz({ website_url: "" }))), false);
  assert.match(servicePage(ctx(), biz()), /href="\/contact\?business=wolbi-foods"/);
});

test("logos have alt text, and a business without one shows its initial", () => {
  const withLogo = servicesPage(ctx([biz({ logo: "https://cdn.example/x.png", logo_alt: "Foods logo" })]));
  assert.match(withLogo, /<img[^>]+alt="Foods logo"/);
  assert.match(servicesPage(ctx([biz({ logo: "https://cdn.example/x.png" })])), /alt="Wolbi Foods logo"/);
  const plain = servicesPage(ctx());
  assert.equal(/<img class="logo/.test(plain), false);
  assert.match(plain, /class="logo md mono" aria-hidden="true">W</);
  assert.equal(monogram("  élan"), "É");
});

test("an empty list says so instead of showing a blank gap", () => {
  assert.match(homePage(ctx([])), /We are adding the details of our services/);
  assert.match(servicesPage(ctx([])), /We are adding the details of our services/);
  assert.equal(/<select/.test(contactPage(ctx([]))), false);
});

test("the contact form keeps what was typed and explains each mistake", () => {
  const html = contactPage(ctx(), { values: { name: "Ama", email: "bad", message: "<b>hi</b>" }, errors: { email: "Enter a valid email address." }, notice: "Please fix the highlighted fields." });
  assert.match(html, /value="Ama"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /id="email-err"/);
  assert.match(html, /aria-invalid="true" aria-describedby="email-err"/);
  assert.equal(html.includes("<b>hi"), false);
  assert.match(html, /name="website" tabindex="-1" autocomplete="off"/);
  assert.match(contactPage(ctx(), { state: "sent" }), /Message sent/);
  assert.equal(/<form/.test(contactPage(ctx(), { state: "sent" })), false);
});

test("the sitemap lists every page, and is empty until the domain is known", () => {
  const xml = sitemap(site, [biz()], { magazia: MAG });
  assert.ok(xml.includes("https://www.example.org/magazia<"));
  for (const p of ["/", "/about", "/services", "/contact", "/services/wolbi-foods"]) assert.ok(xml.includes(`https://www.example.org${p}<`), p);
  assert.equal(sitemap({ url: "" }, [biz()]), "");
});

test("canonical links and structured data appear when the domain is known and never break out of their script tag", () => {
  const html = homePage(ctx([biz({ name: "</script><b>" })]));
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.example\.org\/">/);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.equal(/rel="canonical"/.test(notFoundPage(ctx())), false);
  assert.match(notFoundPage(ctx()), /noindex/);
});

test("helpers", () => {
  assert.equal(esc(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
  assert.deepEqual(paragraphs("a\n\n\n b \n\nc"), ["a", "b", "c"]);
  assert.ok(fallbackBusinesses.length >= 1);
});

test("contact page shows a WhatsApp link only when a number is set", () => {
  const withNumber = contactPage({ site, profile: { ...fallbackProfile, whatsapp_number: "+233 24 123 4567" }, businesses: [] });
  assert.match(withNumber, /https:\/\/wa\.me\/233241234567/);
  assert.doesNotMatch(contactPage({ site, profile: { ...fallbackProfile }, businesses: [] }), /wa\.me/);
});

test("contact buttons show Email, Call and WhatsApp with icons, never the address or numbers", async () => {
  const { contactButtons } = await import("../src/render.mjs");
  const html = contactButtons({ contact_email: "help@example.com", phone: "+233 24 000 0000", whatsapp_number: "233240000000" });
  assert.match(html, /href="mailto:help@example\.com"/);
  assert.match(html, /href="tel:\+233240000000"/);
  assert.match(html, /href="https:\/\/wa\.me\/233240000000"/);
  for (const word of [">Email<", ">Call<", ">WhatsApp<"]) assert.ok(html.includes(word), word);
  assert.equal((html.match(/<svg/g) || []).length, 3);
  const visible = html.replace(/<[^>]*>/g, "");
  assert.ok(!/help@example|233|24 000/.test(visible), "no address or number in the visible text");
  assert.equal(contactButtons({}), "");
});

test("two phone numbers get two Call buttons, named so people can tell them apart", async () => {
  const { contactButtons } = await import("../src/render.mjs");
  const plain = contactButtons({ phone: "+233 24 000 0000", phone_2: "+233 20 111 2222" });
  assert.match(plain, /href="tel:\+233240000000"/);
  assert.match(plain, /href="tel:\+233201112222"/);
  assert.ok(plain.includes(">Call 1<") && plain.includes(">Call 2<"));
  const named = contactButtons({ phone: "+233 24 000 0000", phone_label: "Sales", phone_2: "+233 20 111 2222", phone_2_label: "Support <b>" });
  assert.ok(named.includes(">Sales<") && named.includes(">Support &lt;b&gt;<"));
  assert.ok(!/233/.test(named.replace(/<[^>]*>/g, "")), "numbers stay out of the visible text");
  assert.ok(contactButtons({ phone: "+233 24 000 0000" }).includes(">Call<"), "one number keeps the plain Call label");
  assert.ok(contactButtons({ phone_2: "+233 20 111 2222" }).includes(">Call<"), "a lone second number reads Call");
});

test("a list of contacts gives one button each: named ones keep their name, unnamed ones are numbered", async () => {
  const { contactButtons } = await import("../src/render.mjs");
  const html = contactButtons({ contacts: [
    { kind: "whatsapp", label: "Orders", value: "233200000001" },
    { kind: "whatsapp", label: "", value: "233200000002" },
    { kind: "whatsapp", label: "", value: "233200000003" },
    { kind: "email", label: "Sales <x>", value: "sales@example.org" },
    { kind: "phone", label: "", value: "+233 24 000 0000" },
  ] });
  assert.equal((html.match(/class="contact-chip"/g) || []).length, 5);
  assert.ok(html.includes(">Orders<") && html.includes(">WhatsApp 1<") && html.includes(">WhatsApp 2<"));
  assert.ok(html.includes("Sales &lt;x&gt;"), "names are escaped");
  assert.ok(html.indexOf("mailto:") < html.indexOf("tel:") && html.indexOf("tel:") < html.indexOf("wa.me"), "Email, then Call, then WhatsApp");
  assert.ok(html.includes("(WhatsApp)"), "the kind is spoken to screen readers when a name is shown");
  assert.equal(contactButtons({ contacts: [] }), "");
});

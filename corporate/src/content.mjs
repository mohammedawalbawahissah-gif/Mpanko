// Everything the site says lives in this file. To change the wording, edit here and run `npm run build`.
// Anything the client still has to confirm is listed in PLACEHOLDERS below, and `npm run build` prints that list.

export const site = {
  name: "Mpanko",
  tagline: "Rooted in Africa. Made for the World.",
  // Set SITE_URL (for example https://www.example.com) when the domain is known. It feeds the sitemap and share links.
  url: (process.env.SITE_URL || "").replace(/\/$/, ""),
  // Where the shop lives. Set SHOP_URL on Railway to the storefront's address.
  shopUrl: (process.env.SHOP_URL || "https://shop.example.com").replace(/\/$/, ""),
  email: process.env.CONTACT_EMAIL || "hello@example.com",
  phone: process.env.CONTACT_PHONE || "",
  address: process.env.CONTACT_ADDRESS || "",
  description: "Mpanko sells products made by African makers to customers around the world, with prices in your currency and tracked delivery.",
};

export const nav = [
  { label: "About", href: "#about" },
  { label: "What we sell", href: "#sell" },
  { label: "How an order travels", href: "#journey" },
  { label: "Contact", href: "#contact" },
];

export const hero = {
  heading: site.tagline,
  lead: "We bring well-made products from African makers to customers in more than one country. You see the full price, delivery and duties before you pay.",
};

export const about = {
  heading: "About us",
  paragraphs: [
    "We started Mpanko so that good things made in Africa are easy to buy from anywhere. Each product comes from a maker we have checked, and every order is packed and tracked until it reaches you.",
    "Our team works from Tamale, Ghana, with partners who handle shipping and payment in each country we serve.",
  ],
};

export const sell = {
  heading: "What we sell",
  intro: "A small range, chosen with care. It grows as we add makers.",
  items: [
    { name: "Textiles and clothing", text: "Woven cloth, scarves and garments made by hand or on small looms." },
    { name: "Home and decor", text: "Baskets, bowls, wall pieces and other things for the home." },
    { name: "Beauty and wellness", text: "Shea butter, soaps and oils made in small batches." },
    { name: "Pantry", text: "Spices, teas and other food that travels well." },
  ],
};

export const journey = {
  heading: "How an order travels",
  intro: "From the maker to your door, in four steps.",
  steps: [
    { name: "Made by the maker", text: "The maker produces the item, or we collect it from stock we hold." },
    { name: "Checked and packed", text: "We check it, pack it for the journey and record the order." },
    { name: "Sent with a tracked carrier", text: "A carrier takes it from us. You get a tracking number by email." },
    { name: "Delivered to you", text: "Delivery cost, tax and any import duty are shown at checkout, so there are no surprises." },
  ],
};

export const contact = {
  heading: "Talk to us",
  intro: "Questions about an order, a product or working together? Write to us and we will reply within two working days.",
};

export const footer = {
  links: [
    { label: "Shop", href: site.shopUrl + "/shop" },
    { label: "Terms of sale", href: site.shopUrl + "/terms" },
    { label: "Privacy", href: site.shopUrl + "/privacy" },
    { label: "Returns", href: site.shopUrl + "/returns-policy" },
  ],
};

// What the client still has to supply or confirm (SRS open decision OD-13). The build prints this list.
export const PLACEHOLDERS = [
  "Company name, logo and brand guidelines (the site uses the shop name Mpanko and its tagline for now)",
  "The domain, set as SITE_URL; the shop address, set as SHOP_URL",
  "Contact email, phone and address (CONTACT_EMAIL, CONTACT_PHONE, CONTACT_ADDRESS)",
  "The About text: who the business is, when it started, who runs it",
  "The product range under What we sell (depends on the product categories decision, OD-02)",
  "Real photographs of makers and products; the site has none yet",
  "Whether the journey steps match how orders are really fulfilled (OD-01, OD-03, OD-07)",
];

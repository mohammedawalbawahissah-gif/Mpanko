// Settings from the environment, plus the fallback wording the site uses when the API is not configured or cannot be reached.
// The real wording (company details, businesses) is edited in the admin app under Businesses and Site details.
// Anything the client still has to confirm is listed in PLACEHOLDERS below, and `npm run build` prints that list.

const clean = (v) => (v || "").replace(/\/$/, "");

export const site = {
  // The API this site reads from, for example https://api.example.com. Without it the site shows the fallback wording below.
  apiUrl: clean(process.env.API_URL),
  // Set SITE_URL (for example https://www.example.com) once the domain is known. It feeds canonical links and the sitemap.
  url: clean(process.env.SITE_URL),
  // Optional: the shop's address, used only for the policy links in the footer (terms, privacy, returns).
  shopUrl: clean(process.env.SHOP_URL),
};

export const fallbackProfile = {
  company_name: "Mpanko",
  tagline: "Rooted in Africa. Made for the World.",
  intro: "We run businesses that bring well-made African products and services to customers in more than one country.",
  about:
    "We started with one idea: good things made in Africa should be easy to buy from anywhere. Today we run more than one business, each with its own team and its own customers.\n\nOur head office is in Tamale, Ghana. We work with partners who handle shipping and payment in each country we serve.",
  contact_email: process.env.CONTACT_EMAIL || "hello@example.com",
  phone: process.env.CONTACT_PHONE || "",
  address: process.env.CONTACT_ADDRESS || "",
  linkedin_url: "", instagram_url: "", facebook_url: "", x_url: "",
};

// Shown only while the API cannot be reached, so the site is never blank.
export const fallbackBusinesses = [
  {
    slug: "mpanko-shop", name: "Mpanko shop", sector: "Retail", location: "Tamale, Ghana",
    tagline: "African-made products, delivered worldwide.",
    summary: "An online shop for products made by African makers, with prices in your currency and tracked delivery.",
    description: "Textiles and clothing, home and decor, beauty and wellness, and pantry goods, from makers we have checked.\n\nYou see the full price, delivery and any import duty before you pay, and you get a tracking number by email.",
    website_url: process.env.SHOP_URL || "", logo: "", logo_alt: "", is_featured: true,
  },
];

// What the client still has to supply or confirm (SRS open decision OD-13). The build prints this list.
export const PLACEHOLDERS = [
  "The company's real name, logo and brand guidelines (the site shows Mpanko and its tagline for now)",
  "The list of businesses: for each, a name, one-line summary, description, sector, logo and the address people visit",
  "The About text: who the group is, when it started, who runs it",
  "Contact email, phone and address, entered under Site details in the admin app",
  "The domain, set as SITE_URL; the API address, set as API_URL",
  "Real photographs of the businesses and the team; the site has none yet",
  "Social media links, if the client wants them shown",
];

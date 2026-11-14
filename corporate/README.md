# Corporate website

The business's own site: who we are, what we sell, how an order travels, how to reach us. It is a separate, static site
(no framework, no browser JavaScript) and is not part of the shop. Requirement S3.1-12.

**First version.** The wording is placeholder text. The real company name, brand, domain, contact details, About text and
photographs come from the client (open decision OD-13). `npm run build` prints what is still missing.

## Change the wording

All text is in `src/content.mjs`. Colours and type are in `src/styles.css` (the `:root` block at the top).

## Run it on your computer

```
cd corporate
npm install
npm run dev
```

Open http://localhost:3000. `npm test` runs the checks.

## Put it on Railway

1. In Railway, add a service from the same GitHub repo and set its **Root Directory** to `corporate`.
2. Build command `npm run build`, start command `npm start`.
3. Set these variables on the service:

| Variable | Meaning |
|---|---|
| `SITE_URL` | The site's address once the domain is known, for example `https://www.example.com` (used for the sitemap and share links) |
| `SHOP_URL` | The storefront's address, for the "Visit the shop" button and footer links |
| `CONTACT_EMAIL` | Shown on the page; `mailto:` links use it |
| `CONTACT_PHONE`, `CONTACT_ADDRESS` | Optional; shown only when set |

## What is deliberately left out for now

No contact form (the page links to email, so no server or spam handling is needed yet), no photographs, no languages other
than English, no analytics or cookies.

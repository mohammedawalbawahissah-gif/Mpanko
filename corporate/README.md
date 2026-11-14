# Corporate website

The company's own site: who we are, the businesses under it, and how to reach us. Requirement S3.1-12. It is separate from
the shop, has no framework and sends no JavaScript to the browser.

## Where the content comes from

The site has **no database of its own**. It reads from the Mpanko API (the `corporate` app in `backend/`), so there is one
backend, one set of staff logins and one place to manage everything. Staff manage it in the admin app:

| Admin page | What it controls |
|---|---|
| Businesses | Each business on the site: name, sector, summary, full description, logo, website address, order, featured, published |
| Site details | Company name, tagline, introduction, About text, contact email, phone, address, social links |
| Enquiries | Messages sent through the contact form: read, add an internal note, mark handled |

Changes show on the site within a minute (the site remembers each answer from the API for 60 seconds).

If the API is unreachable the site keeps working: it shows the last answer it had, or built-in wording if it has never
had one. Real names, logos and text come from the client (open decision OD-13); until they are entered in the admin the
site shows placeholder wording, and `npm run build` prints what is still missing.

The contact form is a plain form post. The site's server checks it and forwards it to the API, so the visitor's browser
never talks to the API and the strict security policy (no scripts, no inline styles) stays on. Spam is handled by a hidden
field, a per-visitor limit on the site and a throttle on the API.

## Run it on your computer

Start the API first (`DEBUG=true python manage.py migrate`, then `python manage.py seed_demo`, then
`python manage.py runserver 8000`). Then:

```
cd corporate
npm install
npm run build
API_URL=http://localhost:8000 PORT=3000 npm start
```

Open http://localhost:3000. Without `API_URL` the site shows its built-in wording. `npm test` runs the checks.

## Put it on Railway

1. In Railway, add a service from the same GitHub repo and set its **Root Directory** to `corporate`.
2. Build command `npm run build`, start command `npm start`.
3. Set these variables on the service:

| Variable | Meaning |
|---|---|
| `API_URL` | The Mpanko API's address, for example `https://api.example.com` (required for real content) |
| `SITE_URL` | This site's address once the domain is known (sitemap, canonical links, share cards) |
| `SHOP_URL` | The storefront's address, for the "Visit the shop" links |
| `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_ADDRESS` | Fallbacks used only if the API is unreachable and Site details have not been loaded |
| `IMG_ORIGINS` | Optional. Limits where images may load from (your R2/CDN address). By default any https image is allowed |

On the **API** service, nothing new is required. Optional: `THROTTLE_CORPORATE_CONTACT` (default `200/hour`) and
`RETENTION_HANDLED_ENQUIRY_DAYS` (default 730).

## Not included yet

No photographs beyond logos, no languages other than English, no analytics or cookies.

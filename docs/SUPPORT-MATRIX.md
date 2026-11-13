# Support matrix

What Mpanko is built and tested for. Anything outside this list may work but is not checked.

## Browsers (web shop and admin)

| Browser | Oldest supported | How it is checked |
| --- | --- | --- |
| Chrome / Chromium, Edge | 100 | Playwright (every CI run) |
| Firefox | 100 | Playwright with `E2E_ALL_BROWSERS=1` |
| Safari (macOS) | 15.4 | Playwright WebKit with `E2E_ALL_BROWSERS=1` |
| Safari (iPhone, iPad) | iOS 15.4 | WebKit and a phone-sized viewport only. Test on a real iPhone before launch. |
| Chrome on Android, Samsung Internet | 100 / 18 | Phone-sized Chrome in Playwright. Test on a real Android phone before launch. |

The same list is in `browserslist` in `web/package.json` and `admin/package.json`. Internet Explorer is not supported.

To run the shop tests on every browser:

```
cd e2e
npx playwright install firefox webkit chromium
set E2E_ALL_BROWSERS=1        (Windows CMD)   export E2E_ALL_BROWSERS=1   (Mac/Linux)
npm test
```

WebKit in Playwright is close to Safari but is not Safari. Real-device checks stay on the go-live list.

## Mobile app

| Platform | Supported |
| --- | --- |
| Android | Android 7 (API 24) and newer, as set by Expo SDK 58 |
| iPhone / iPad | iOS 15.1 and newer, as set by Expo SDK 58 |

Building the app needs Node 22.13 or newer.

## Screens and languages

- Web layouts are checked from a 360 px wide phone up to large desktops.
- Languages: English, French, Spanish. French and Spanish text needs review by a native speaker before launch.
- Keyboard use and screen-reader labels are checked with automated axe tests (WCAG 2.2 AA rules). A person should still try the shop with a keyboard and a screen reader before launch.

## Server

- Python 3.12, Django 5.2, PostgreSQL 15 or newer, Redis for background jobs.
- Node 20 for the web and admin builds.

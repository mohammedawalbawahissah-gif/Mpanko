# Security checks

## What runs on every push

The CI build fails if a known **high** or **critical** vulnerability is found in what we ship:

- Backend: `pip-audit -r backend/requirements.txt`
- Shop, admin, mobile app and corporate site: `npm audit --omit=dev --audit-level=high`

Run the same checks yourself any time:

```
cd backend
pip install pip-audit
pip-audit -r requirements.txt

cd ../web
npm audit --omit=dev
```

## Result on 2026-11-14

| Part | Result |
|---|---|
| Backend (Python) | No known vulnerabilities. |
| Corporate site | No known vulnerabilities. |
| Shop and admin | 2 moderate findings in React Router (GHSA-337j-9hxr-rhxg). Not exploitable here, see below. |
| Mobile app | 3 moderate findings in `minimatch`, reached through Expo's build tools. Not exploitable here, see below. |

### Accepted moderate findings

**React Router (shop and admin).** The advisory is about server-side rendering and hydration. Both apps are plain browser apps: they never render React on a server and never use React Router's server features. The fix is a major version upgrade (v6 to v7) that would need re-testing of every page. Revisit when moving to v7 for other reasons.

**minimatch (mobile app).** Reached only through Expo's build-time tooling (`@expo/fingerprint`) on a developer's computer or the build server. It is not part of the app that runs on a customer's phone. The fix is a major Expo upgrade, which should be done with the next planned Expo upgrade.

## Other protection already in place

- API: security headers and a strict Content-Security-Policy on every JSON response, HTTPS redirect and HSTS in production, rate limits per IP and per account, two-step sign-in for staff, hashed passwords, short-lived tokens with rotation.
- Shop, admin and corporate site: Content-Security-Policy, HSTS, no framing, no sniffing, strict referrer policy.
- `python manage.py preflight` checks production settings before launch.

## Not covered by these checks

A human penetration test (TST-07) is still to be arranged. Automated checks do not replace it.

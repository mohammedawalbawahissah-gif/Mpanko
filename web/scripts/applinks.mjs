// Runs after `vite build`. Writes the two files phones read to decide whether this site's links open the Mpanko app:
//   dist/.well-known/assetlinks.json              (Android; needs ANDROID_SHA256_FINGERPRINT from your Play/EAS signing key)
//   dist/.well-known/apple-app-site-association   (iPhone; needs APPLE_TEAM_ID from your Apple developer account)
// With neither set, nothing is written, so no half-filled file ever ships. See docs/APP-LINKS.md.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATHS = ["/shop/*", "/orders/*", "/support/*"];

export function buildLinks({ teamId = "", androidFingerprint = "", iosBundleId = "com.wolbiroyal.mpanko", androidPackage = "com.wolbiroyal.mpanko" } = {}) {
  const files = {};
  if (androidFingerprint.trim()) {
    files["assetlinks.json"] = [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: androidPackage, sha256_cert_fingerprints: androidFingerprint.split(",").map((s) => s.trim()).filter(Boolean) },
      },
    ];
  }
  if (teamId.trim()) {
    files["apple-app-site-association"] = {
      applinks: { details: [{ appIDs: [`${teamId.trim()}.${iosBundleId}`], components: PATHS.map((p) => ({ "/": p })) }] },
    };
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = buildLinks({ teamId: process.env.APPLE_TEAM_ID, androidFingerprint: process.env.ANDROID_SHA256_FINGERPRINT });
  const dir = path.resolve("dist", ".well-known");
  if (!Object.keys(files).length) {
    console.log("App links: APPLE_TEAM_ID and ANDROID_SHA256_FINGERPRINT are not set, so no link files were written.");
  } else {
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await writeFile(path.join(dir, name), JSON.stringify(body, null, 2));
      console.log("App links: wrote", name);
    }
  }
}

// Prepares dist/ with the files the server hands out as they are: the stylesheet, the two fonts and the icon.
// The pages themselves are made on request by server.mjs from the API. No dependencies and no browser JavaScript.
//   node scripts/build.mjs [outDir]
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1b2455"/><path d="M12 50V14h8l12 20 12-20h8v36h-8V30L32 48 20 30v20z" fill="#c98e2b"/></svg>`;

export async function build(outDir = path.join(root, "dist")) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "fonts"), { recursive: true });
  copyFileSync(path.join(root, "src", "styles.css"), path.join(outDir, "styles.css"));
  writeFileSync(path.join(outDir, "favicon.svg"), FAVICON);
  for (const [pkg, file] of [["bricolage-grotesque", "bricolage-grotesque-latin-wght-normal.woff2"], ["public-sans", "public-sans-latin-wght-normal.woff2"]]) {
    copyFileSync(path.join(root, "node_modules", "@fontsource-variable", pkg, "files", file), path.join(outDir, "fonts", file));
  }
  return outDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = await build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  const { PLACEHOLDERS } = await import(pathToFileURL(path.join(root, "src", "content.mjs")).href);
  console.log(`Built ${out}`);
  console.log("\nStill to come from the client:");
  for (const p of PLACEHOLDERS) console.log(`  - ${p}`);
}

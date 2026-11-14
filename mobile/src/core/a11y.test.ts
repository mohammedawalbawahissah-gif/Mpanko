import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..");
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));

/** Every opening tag of `name`, from "<Name" to its closing ">" (tags here do not contain a bare ">" before the end except in arrows). */
function tags(text: string, name: string): string[] {
  const out: string[] = [];
  let i = text.indexOf(`<${name}`);
  while (i !== -1) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && text[j - 1] !== "=") break;
    }
    out.push(text.slice(i, j + 1));
    i = text.indexOf(`<${name}`, j);
  }
  return out;
}

describe("mobile accessibility guard rails", () => {
  it("every Pressable says what it is", () => {
    for (const { f, text } of files) for (const tag of tags(text, "Pressable")) expect(tag, f).toMatch(/accessibilityRole/);
  });
  it("tappable text is a link or button, or is hidden because a labelled control sits beside it", () => {
    for (const { f, text } of files) for (const tag of tags(text, "Text")) if (/\sonPress=/.test(tag)) expect(tag, f).toMatch(/accessibilityRole|importantForAccessibility/);
  });
  it("buttons with only a symbol have a spoken label", () => {
    for (const { f, text } of files) for (const tag of tags(text, "Button")) if (/title="[+−-]"/.test(tag)) expect(tag, f).toMatch(/label=/);
  });
  it("screen titles are announced as headings", () => {
    for (const { f, text } of files) expect(text, f).not.toMatch(/<Text style=\{s\.(h1|h2)\}>/);
  });
});

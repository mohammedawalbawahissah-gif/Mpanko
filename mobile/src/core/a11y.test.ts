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

describe("forms and the keyboard", () => {
  it("no screen puts an Input or AddressForm inside a bare ScrollView (use FormScreen so the keyboard never covers the field)", () => {
    for (const { f, text } of files) {
      if (f === "ui.tsx") continue;
      for (const m of text.matchAll(/<ScrollView(?![^>]*horizontal)[^>]*>([\s\S]*?)<\/ScrollView>/g)) expect(m[1], f).not.toMatch(/<Input|<TextInput|<AddressForm/);
    }
  });
});

describe("lists that change on the server", () => {
  it("the shop list, orders and support list can be pulled down to refresh", () => {
    for (const f of ["screens-shop.tsx", "screens-buy.tsx", "screens-help.tsx"]) {
      const text = files.find((x) => x.f === f)!.text;
      expect(text, f).toMatch(/usePullRefresh/);
      expect(text, f).toMatch(/refreshControl=\{pull\.control\}/);
    }
  });
  it("every tab has an icon and the product screen is titled with the product", () => {
    const app = readFileSync(join(dir, "..", "App.tsx"), "utf8");
    expect(app).toMatch(/tabBarIcon: \(\{ color: tint \}\) => <TabIcon/);
    expect(files.find((x) => x.f === "screens-shop.tsx")!.text).toMatch(/setOptions\(\{ title: productName \}\)/);
  });
});

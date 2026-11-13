// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildLinks } from "./applinks.mjs";

describe("app link files", () => {
  it("writes nothing until real values are supplied", () => {
    expect(buildLinks({})).toEqual({});
  });
  it("builds the Android file from a fingerprint", () => {
    const f = buildLinks({ androidFingerprint: "AA:BB, CC:DD" });
    const entry = f["assetlinks.json"][0];
    expect(entry.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(entry.target.package_name).toBe("com.wolbiroyal.mpanko");
    expect(entry.target.sha256_cert_fingerprints).toEqual(["AA:BB", "CC:DD"]);
    expect(f["apple-app-site-association"]).toBeUndefined();
  });
  it("builds the iPhone file from a team id", () => {
    const f = buildLinks({ teamId: "ABCDE12345" });
    const d = f["apple-app-site-association"].applinks.details[0];
    expect(d.appIDs).toEqual(["ABCDE12345.com.wolbiroyal.mpanko"]);
    expect(d.components.map((c) => c["/"])).toEqual(["/shop/*", "/orders/*", "/support/*"]);
  });
});

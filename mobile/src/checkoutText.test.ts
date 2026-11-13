import { describe, expect, it } from "vitest";
import { LANGUAGES, translate } from "./i18n";

const KEYS = ["m.wrongNoCharge", "m.cantShip", "m.cancelTitle", "m.saveAddress", "m.errCountry", "status.pending_payment", "checkout.pay", "orders.cancel"] as const;

describe("mobile checkout text", () => {
  it("is available in every language, with its placeholders", () => {
    for (const { code } of LANGUAGES) {
      for (const key of KEYS) {
        const text = translate(code, key);
        expect(text, `${code} ${key}`).not.toBe(key);
      }
      const ship = translate(code, "m.cantShip", { items: "Scarf", country: "GH" });
      expect(ship).toContain("Scarf");
      expect(ship).toContain("GH");
    }
  });

  it("is really translated, not left in English", () => {
    for (const code of ["fr", "es", "ha"]) {
      expect(translate(code, "m.cancelTitle")).not.toBe(translate("en", "m.cancelTitle"));
      expect(translate(code, "status.paid")).not.toBe("Paid");
    }
  });
});

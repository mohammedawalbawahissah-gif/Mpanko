import { describe, expect, it } from "vitest";
import { mainPhoto, photoLabel, photoList, type ProductPhoto } from "./images";

const p = (id: number, position: number, image = `https://cdn.example/${id}.jpg`, alt = ""): ProductPhoto => ({ id, image, alt_text: alt, position });

describe("product photos", () => {
  it("orders by position, then id", () => {
    expect(photoList([p(3, 2), p(1, 1), p(2, 1)]).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("drops photos without a usable web address", () => {
    expect(photoList([p(1, 0, ""), p(2, 1, "/media/a.jpg"), p(3, 2)]).map((x) => x.id)).toEqual([3]);
  });

  it("copes with nothing", () => {
    expect(photoList(undefined)).toEqual([]);
    expect(photoList(null)).toEqual([]);
    expect(mainPhoto([])).toBeNull();
  });

  it("uses the first photo as the main one", () => {
    expect(mainPhoto([p(2, 1), p(1, 0)])?.id).toBe(1);
  });

  it("describes a photo by its alt text, else by the product name", () => {
    expect(photoLabel(p(1, 0, undefined, " Red scarf "), "Kente scarf")).toBe("Red scarf");
    expect(photoLabel(p(1, 0), "Kente scarf")).toBe("Kente scarf");
  });
});

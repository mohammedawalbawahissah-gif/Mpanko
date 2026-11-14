/** Which product photo to show, and its description for screen readers. */

export interface ProductPhoto { id: number; image: string; alt_text: string; position: number }

const URL_OK = /^https?:\/\//i;

/** Photos in the order staff set, keeping only ones with a usable web address. */
export function photoList(images: ProductPhoto[] | undefined | null): ProductPhoto[] {
  return (images ?? [])
    .filter((p) => typeof p?.image === "string" && URL_OK.test(p.image))
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

/** The first photo, used on cards. */
export function mainPhoto(images: ProductPhoto[] | undefined | null): ProductPhoto | null {
  return photoList(images)[0] ?? null;
}

/** What a screen reader says: the staff-written description, or the product name. */
export function photoLabel(photo: Pick<ProductPhoto, "alt_text">, productName: string): string {
  return photo.alt_text?.trim() || productName;
}

import type { MessageKey } from "./locales";

export interface AddressRules {
  country: string;
  postal_code: "required" | "optional" | "none";
  region_required: boolean;
  region_label: string;
  postal_example: string;
  regions?: string[];
}

export interface FieldHints {
  showPostal: boolean;
  postalLabel: MessageKey;
  postalPlaceholder: string;
  regionLabel: string;
  regionRequired: boolean;
}

/** What the address form should show for a country, given the server's rules (null while they load). */
export function fieldHints(rules: AddressRules | null): FieldHints {
  if (!rules) return { showPostal: true, postalLabel: "address.postalOptional", postalPlaceholder: "", regionLabel: "Region or state", regionRequired: false };
  return {
    showPostal: rules.postal_code !== "none",
    postalLabel: rules.postal_code === "required" ? "address.postalRequired" : rules.postal_code === "none" ? "address.postalNone" : "address.postalOptional",
    postalPlaceholder: rules.postal_example,
    regionLabel: rules.region_required ? rules.region_label : `${rules.region_label} (optional)`,
    regionRequired: rules.region_required,
  };
}

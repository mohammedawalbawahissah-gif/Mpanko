export interface Variant {
  id: number;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  price: string;
  is_active: boolean;
  in_stock: boolean;
  on_backorder?: boolean;
  backorder_days?: number | null;
  made_to_order?: boolean;
  lead_time_days?: number | null;
}

export interface ProductImage {
  id: number;
  image: string;
  alt_text: string;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: number | null;
  category_name: string | null;
  origin_country: string;
  maker: string;
  base_price: string;
  currency: string;
  status: string;
  variants: Variant[];
  images: ProductImage[];
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  email_verified: boolean;
  marketing_opt_in?: boolean;
  notify_order_emails?: boolean;
  notify_sms?: boolean;
  notify_whatsapp?: boolean;
  phone_verified?: boolean;
  notify_push?: boolean;
  preferred_currency?: string;
}

export interface Address {
  id: number;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

export interface ServerCartItem {
  id: number;
  variant: number;
  sku: string;
  product_slug: string;
  product_name: string;
  unit_price: string;
  currency: string;
  quantity: number;
}

export interface ShippingService {
  service_code: string;
  service_name: string;
  price: string;
  currency: string;
  eta_days_min: number | null;
  eta_days_max: number | null;
}

export interface OrderItem {
  product_name: string;
  variant_name: string;
  sku: string;
  unit_price: string;
  quantity: number;
  line_total: string;
}

export interface TrackingEvent {
  id: number;
  status: string;
  description: string;
  location: string;
  occurred_at: string;
}

export interface Shipment {
  id: number;
  carrier_name: string | null;
  service_name: string;
  tracking_number: string;
  status: string;
  events: TrackingEvent[];
}

export interface Order {
  number: string;
  status: string;
  currency: string;
  subtotal: string;
  shipping_total: string;
  tax_total: string;
  discount_total?: string;
  coupon_code?: string;
  grand_total: string;
  fx_rate_note: string;
  shipping_address: Record<string, string>;
  shipping_service: { service_name?: string };
  created_at: string;
  paid_at: string | null;
  items: OrderItem[];
  events: { from_status: string; to_status: string; note: string; created_at: string }[];
  shipments: Shipment[];
}

export interface OrderSummary {
  number: string;
  status: string;
  currency: string;
  grand_total: string;
  item_count: number;
  created_at: string;
}

export interface PaymentMethod {
  provider: string;
  currencies: string[];
  manual?: boolean;
}

export interface TaxEstimate {
  tax: string;
  duties: null | {
    country: string;
    currency: string;
    duty: string;
    vat: string;
    total: string;
    below_threshold: boolean;
    note: string;
    mode: "estimate" | "prepaid";
  };
}

export interface AddressRules {
  country: string;
  postal_code: "required" | "optional" | "none";
  region_required: boolean;
  region_label: string;
  postal_example: string;
  regions?: string[];
}

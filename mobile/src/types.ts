export interface Variant { id: number; sku: string; name: string; price: string; in_stock: boolean; is_active: boolean }
export interface Product {
  id: number; name: string; slug: string; description: string; category: number | null; category_name: string | null;
  origin_country: string; maker: string; base_price: string; currency: string; variants: Variant[];
}
export interface Category { id: number; name: string; slug: string }
export interface User {
  id: number; email: string; full_name: string; role: string; email_verified: boolean; phone?: string; phone_verified?: boolean;
  notify_order_emails?: boolean; notify_sms?: boolean; notify_push?: boolean; marketing_opt_in?: boolean; preferred_currency?: string;
}
export interface TaxEstimate {
  tax: string;
  duties: null | { country: string; currency: string; duty: string; vat: string; total: string; below_threshold: boolean; note: string; mode: "estimate" | "prepaid" };
}
export interface Address {
  id: number; recipient_name: string; phone: string; line1: string; line2: string; city: string; region: string; postal_code: string; country: string; is_default: boolean;
}
export interface CartItem { id: number; variant: number; sku: string; product_slug: string; product_name: string; unit_price: string; currency: string; quantity: number }
export interface ShippingService { service_code: string; service_name: string; price: string; currency: string; eta_days_min: number | null; eta_days_max: number | null }
export interface PaymentMethod { provider: string; currencies: string[] }
export interface TrackingEvent { id: number; status: string; description: string; location: string; occurred_at: string }
export interface Shipment { id: number; carrier_name: string | null; tracking_number: string; status: string; events: TrackingEvent[] }
export interface OrderItem { sku: string; product_name: string; variant_name: string; quantity: number; line_total: string }
export interface Order {
  number: string; status: string; currency: string; shipping_total: string; tax_total: string; grand_total: string;
  shipping_address: Record<string, string>; items: OrderItem[]; shipments: Shipment[];
  events: { to_status: string; created_at: string }[];
}
export interface OrderSummary { number: string; status: string; currency: string; grand_total: string; item_count: number; created_at: string }

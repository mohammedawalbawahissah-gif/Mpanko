import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "./api";
import { AuthProvider, ROLE_LABEL, useAuth } from "./auth";
import { Login } from "./login";
import { Loading } from "./ui";
import { Dashboard, OrderDetail, Orders, ShipmentDetail, Shipments } from "./pages-ops";
import { Products, Stock } from "./pages-catalog";
import { Emails } from "./pages-emails";
import { ShippingRules } from "./pages-shipping";
import { PickupLocations, ProductTypes } from "./pages-launch";
import { AuditLog, Pages, Coupons, CustomerDetail, Customers, ReturnDetail, Returns, StaffPage, Support, SupportDetail } from "./pages-store";
import { Chargebacks, ManualPayments, Reconciliation, ReconciliationRun, Reports } from "./pages-finance";
import { TaxAndDuties } from "./pages-tax";
import { Security } from "./pages-security";
import { Businesses, Enquiries, SiteDetails } from "./pages-corporate";

const ALL_STAFF = ["super_admin", "store_admin", "fulfillment", "finance", "support"];
const NAV: { to: string; name: string; roles: string[]; group: string }[] = [
  { to: "/", name: "Dashboard", roles: ALL_STAFF, group: "" },
  { to: "/orders", name: "Orders", roles: ALL_STAFF, group: "Sell" },
  { to: "/manual-payments", name: "Manual payments", roles: ["super_admin", "store_admin", "finance"], group: "Sell" },
  { to: "/returns", name: "Returns", roles: ["super_admin", "store_admin", "fulfillment", "finance", "support"], group: "Sell" },
  { to: "/support", name: "Support", roles: ["super_admin", "store_admin", "fulfillment", "finance", "support"], group: "Sell" },
  { to: "/customers", name: "Customers", roles: ["super_admin", "store_admin", "support"], group: "Sell" },
  { to: "/coupons", name: "Promotions", roles: ["super_admin", "store_admin"], group: "Sell" },
  { to: "/shipments", name: "Shipments", roles: ["super_admin", "store_admin", "fulfillment", "carrier"], group: "Fulfil" },
  { to: "/shipping-rules", name: "Shipping rules", roles: ["super_admin", "store_admin", "fulfillment"], group: "Fulfil" },
  { to: "/pickup-locations", name: "Pickup locations", roles: ["super_admin", "store_admin", "fulfillment"], group: "Fulfil" },
  { to: "/products", name: "Products", roles: ["super_admin", "store_admin"], group: "Catalog" },
  { to: "/stock", name: "Stock", roles: ["super_admin", "store_admin", "fulfillment"], group: "Catalog" },
  { to: "/product-types", name: "Product types", roles: ["super_admin", "store_admin"], group: "Catalog" },
  { to: "/reconciliation", name: "Reconciliation", roles: ["super_admin", "store_admin", "finance"], group: "Money" },
  { to: "/chargebacks", name: "Chargebacks", roles: ["super_admin", "store_admin", "finance"], group: "Money" },
  { to: "/tax", name: "Tax and duties", roles: ["super_admin", "store_admin", "finance"], group: "Money" },
  { to: "/reports", name: "Reports", roles: ["super_admin", "store_admin", "finance", "fulfillment"], group: "Money" },
  { to: "/pages", name: "Policy pages", roles: ["super_admin", "store_admin"], group: "Content" },
  { to: "/emails", name: "Emails", roles: ["super_admin", "store_admin"], group: "Content" },
  { to: "/businesses", name: "Businesses", roles: ["super_admin", "store_admin"], group: "Content" },
  { to: "/site-details", name: "Site details", roles: ["super_admin", "store_admin"], group: "Content" },
  { to: "/enquiries", name: "Enquiries", roles: ["super_admin", "store_admin", "support"], group: "Content" },
  { to: "/staff", name: "Staff", roles: ["super_admin", "store_admin"], group: "Settings" },
  { to: "/audit", name: "Activity log", roles: ["super_admin", "store_admin"], group: "Settings" },
  { to: "/security", name: "Security", roles: ALL_STAFF, group: "Settings" },
];

/** Counts that need someone's attention, shown beside the menu item that handles them. */
function useBadges(role: string | undefined) {
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!role || role === "carrier") return;
    api<{ to_ship?: number; shipping_exceptions?: number; low_stock?: number; unresolved_reconciliation?: number }>("/reports/dashboard/")
      .then((d) => setBadges({ "/orders": d.to_ship ?? 0, "/shipments": d.shipping_exceptions ?? 0, "/stock": d.low_stock ?? 0, "/reconciliation": d.unresolved_reconciliation ?? 0 }))
      .catch(() => setBadges({}));
  }, [role]);
  return badges;
}

function Shell() {
  const { user, ready, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const badges = useBadges(user?.role);
  useEffect(() => setOpen(false), [pathname]);
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const groups = [...new Set(items.map((n) => n.group))];
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <img src="/logo-light.svg" alt="Mpanko" height={56} />
          <button type="button" className="btn quiet nav-toggle" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen((o) => !o)}>Menu</button>
        </div>
        <div id="nav-links" className={`nav-links${open ? " open" : ""}`}>
          {groups.map((g) => (
            <div key={g || "top"} className="nav-group">
              {g && <div className="nav-heading">{g}</div>}
              {items.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === "/"}>
                  {n.name}{!!badges[n.to] && <span className="nav-badge" aria-label={`${badges[n.to]} need attention`}>{badges[n.to]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="who">
            {user.full_name || user.email}<br />{ROLE_LABEL[user.role] ?? user.role}
            <div><button className="btn quiet" onClick={logout}>Sign out</button></div>
          </div>
        </div>
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  if (user?.role === "carrier") return <Navigate to="/shipments" replace />;
  return <Dashboard />;
}

function RunPage() {
  const { id = "" } = useParams();
  return <ReconciliationRun id={id} />;
}

function Guard({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) return <p>You don't have access to this page.</p>;
  return children;
}

const route = (to: string, el: JSX.Element) => <Guard roles={NAV.find((n) => n.to === to)?.roles ?? ALL_STAFF}>{el}</Guard>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="orders" element={route("/orders", <Orders />)} />
            <Route path="orders/:number" element={route("/orders", <OrderDetail />)} />
            <Route path="returns" element={route("/returns", <Returns />)} />
            <Route path="returns/:number" element={route("/returns", <ReturnDetail />)} />
            <Route path="support" element={route("/support", <Support />)} />
            <Route path="support/:number" element={route("/support", <SupportDetail />)} />
            <Route path="customers" element={route("/customers", <Customers />)} />
            <Route path="customers/:id" element={route("/customers", <CustomerDetail />)} />
            <Route path="coupons" element={route("/coupons", <Coupons />)} />
            <Route path="pages" element={route("/pages", <Pages />)} />
            <Route path="businesses" element={route("/businesses", <Businesses />)} />
            <Route path="site-details" element={route("/site-details", <SiteDetails />)} />
            <Route path="enquiries" element={route("/enquiries", <Enquiries />)} />
            <Route path="staff" element={route("/staff", <StaffPage />)} />
            <Route path="audit" element={route("/audit", <AuditLog />)} />
            <Route path="security" element={route("/security", <Security />)} />
            <Route path="shipments" element={route("/shipments", <Shipments />)} />
            <Route path="shipments/:id" element={route("/shipments", <ShipmentDetail />)} />
            <Route path="shipping-rules" element={route("/shipping-rules", <ShippingRules />)} />
            <Route path="pickup-locations" element={route("/pickup-locations", <PickupLocations />)} />
            <Route path="product-types" element={route("/product-types", <ProductTypes />)} />
            <Route path="products" element={route("/products", <Products />)} />
            <Route path="stock" element={route("/stock", <Stock />)} />
            <Route path="reports" element={route("/reports", <Reports />)} />
            <Route path="emails" element={route("/emails", <Emails />)} />
            <Route path="manual-payments" element={route("/manual-payments", <ManualPayments />)} />
            <Route path="chargebacks" element={route("/chargebacks", <Chargebacks />)} />
            <Route path="tax" element={route("/tax", <TaxAndDuties />)} />
            <Route path="reconciliation" element={route("/reconciliation", <Reconciliation />)} />
            <Route path="reconciliation/:id" element={route("/reconciliation", <RunPage />)} />
            <Route path="*" element={<p>That page doesn't exist.</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

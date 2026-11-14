import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useParams } from "react-router-dom";
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
const NAV: { to: string; name: string; roles: string[] }[] = [
  { to: "/", name: "Dashboard", roles: ALL_STAFF },
  { to: "/orders", name: "Orders", roles: ALL_STAFF },
  { to: "/manual-payments", name: "Manual payments", roles: ["super_admin", "store_admin", "finance"] },
  { to: "/shipments", name: "Shipments", roles: ["super_admin", "store_admin", "fulfillment", "carrier"] },
  { to: "/shipping-rules", name: "Shipping rules", roles: ["super_admin", "store_admin", "fulfillment"] },
  { to: "/pickup-locations", name: "Pickup locations", roles: ["super_admin", "store_admin", "fulfillment"] },
  { to: "/product-types", name: "Product types", roles: ["super_admin", "store_admin"] },
  { to: "/returns", name: "Returns", roles: ["super_admin", "store_admin", "fulfillment", "finance", "support"] },
  { to: "/support", name: "Support", roles: ["super_admin", "store_admin", "fulfillment", "finance", "support"] },
  { to: "/customers", name: "Customers", roles: ["super_admin", "store_admin", "support"] },
  { to: "/coupons", name: "Promotions", roles: ["super_admin", "store_admin"] },
  { to: "/pages", name: "Policy pages", roles: ["super_admin", "store_admin"] },
  { to: "/products", name: "Products", roles: ["super_admin", "store_admin"] },
  { to: "/stock", name: "Stock", roles: ["super_admin", "store_admin", "fulfillment"] },
  { to: "/reports", name: "Reports", roles: ["super_admin", "store_admin", "finance", "fulfillment"] },
  { to: "/emails", name: "Emails", roles: ["super_admin", "store_admin"] },
  { to: "/reconciliation", name: "Reconciliation", roles: ["super_admin", "store_admin", "finance"] },
  { to: "/chargebacks", name: "Chargebacks", roles: ["super_admin", "store_admin", "finance"] },
  { to: "/tax", name: "Tax and duties", roles: ["super_admin", "store_admin", "finance"] },
  { to: "/businesses", name: "Businesses", roles: ["super_admin", "store_admin"] },
  { to: "/site-details", name: "Site details", roles: ["super_admin", "store_admin"] },
  { to: "/enquiries", name: "Enquiries", roles: ["super_admin", "store_admin", "support"] },
  { to: "/staff", name: "Staff", roles: ["super_admin", "store_admin"] },
  { to: "/audit", name: "Activity log", roles: ["super_admin", "store_admin"] },
  { to: "/security", name: "Security", roles: ALL_STAFF },
];

function Shell() {
  const { user, ready, logout } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand"><img src="/logo-light.svg" alt="Mpanko" height={56} /></div>
        {items.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"}>{n.name}</NavLink>)}
        <div className="who">
          {user.full_name || user.email}<br />{ROLE_LABEL[user.role] ?? user.role}
          <div><button className="btn quiet" onClick={logout}>Sign out</button></div>
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

import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider, ROLE_LABEL, useAuth } from "./auth";
import { Login } from "./login";
import { Loading } from "./ui";
import { Dashboard, OrderDetail, Orders, ShipmentDetail, Shipments } from "./pages-ops";
import { Products, Stock } from "./pages-catalog";
import { Reconciliation, ReconciliationRun, Reports } from "./pages-finance";

const ALL_STAFF = ["super_admin", "store_admin", "fulfillment", "finance", "support"];
const NAV: { to: string; name: string; roles: string[] }[] = [
  { to: "/", name: "Dashboard", roles: ALL_STAFF },
  { to: "/orders", name: "Orders", roles: ALL_STAFF },
  { to: "/shipments", name: "Shipments", roles: ["super_admin", "store_admin", "fulfillment", "carrier"] },
  { to: "/products", name: "Products", roles: ["super_admin", "store_admin"] },
  { to: "/stock", name: "Stock", roles: ["super_admin", "store_admin", "fulfillment"] },
  { to: "/reports", name: "Reports", roles: ["super_admin", "store_admin", "finance", "fulfillment"] },
  { to: "/reconciliation", name: "Reconciliation", roles: ["super_admin", "store_admin", "finance"] },
];

function Shell() {
  const { user, ready, logout } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">Mpanko</div>
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
            <Route path="shipments" element={route("/shipments", <Shipments />)} />
            <Route path="shipments/:id" element={route("/shipments", <ShipmentDetail />)} />
            <Route path="products" element={route("/products", <Products />)} />
            <Route path="stock" element={route("/stock", <Stock />)} />
            <Route path="reports" element={route("/reports", <Reports />)} />
            <Route path="reconciliation" element={route("/reconciliation", <Reconciliation />)} />
            <Route path="reconciliation/:id" element={route("/reconciliation", <RunPage />)} />
            <Route path="*" element={<p>That page doesn't exist.</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

import { Route, Routes, Link } from "react-router-dom";
import { Layout, RequireAuth } from "./components";
import { Bag, Home, ProductPage, Shop } from "./pages-shop";
import { Checkout, CheckoutComplete, OrderDetail, Orders } from "./pages-checkout";
import { Account, Forgot, Login, Register, Reset, VerifyEmail } from "./pages-account";

function NotFound() {
  return (
    <div className="wrap page empty">
      <h1>We couldn't find that page</h1>
      <Link className="btn" to="/shop">Browse the shop</Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Shop />} />
        <Route path="shop/:slug" element={<ProductPage />} />
        <Route path="bag" element={<Bag />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<Forgot />} />
        <Route path="reset-password" element={<Reset />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
        <Route path="checkout/complete" element={<RequireAuth><CheckoutComplete /></RequireAuth>} />
        <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
        <Route path="orders/:number" element={<RequireAuth><OrderDetail /></RequireAuth>} />
        <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

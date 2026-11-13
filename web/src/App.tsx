import { CookieNotice, Legal } from "./pages-legal";
import { Route, Routes, Link } from "react-router-dom";
import { Layout, RequireAuth } from "./components";
import { Bag, Home, ProductPage, Shop } from "./pages-shop";
import { OrderDetail, Orders } from "./pages-checkout";
import { CheckoutCompleteRoute, CheckoutRoute, FindOrderPage, GuestOrder } from "./pages-guest";
import { ReturnForm, SupportList, SupportNew, SupportThread } from "./pages-help";
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
    <>
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
        <Route path="checkout" element={<CheckoutRoute />} />
        <Route path="checkout/complete" element={<CheckoutCompleteRoute />} />
        <Route path="orders/guest/:number" element={<GuestOrder />} />
        <Route path="orders/find" element={<FindOrderPage />} />
        <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
        <Route path="orders/:number" element={<RequireAuth><OrderDetail /></RequireAuth>} />
        <Route path="orders/:number/return" element={<RequireAuth><ReturnForm /></RequireAuth>} />
        <Route path="support" element={<RequireAuth><SupportList /></RequireAuth>} />
        <Route path="support/new" element={<RequireAuth><SupportNew /></RequireAuth>} />
        <Route path="support/:number" element={<RequireAuth><SupportThread /></RequireAuth>} />
        <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="privacy" element={<Legal slug="privacy" />} />
        <Route path="terms" element={<Legal slug="terms" />} />
        <Route path="returns-policy" element={<Legal slug="returns" />} />
        <Route path="cookies" element={<Legal slug="cookies" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    <CookieNotice />
    </>
  );
}

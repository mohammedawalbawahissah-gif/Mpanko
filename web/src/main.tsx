import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";
import App from "./App";
import { AuthProvider, CartProvider, CurrencyProvider } from "./context";
import { ErrorBoundary } from "./components";
import { I18nProvider } from "./i18n";
import { installGlobalErrorReporting } from "./report";

installGlobalErrorReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <BrowserRouter>
          <AuthProvider>
            <CurrencyProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </CurrencyProvider>
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

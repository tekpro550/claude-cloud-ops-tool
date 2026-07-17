import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { AuthProvider } from "./lib/auth.tsx";
import { I18nProvider } from "./lib/i18n.tsx";
import { TenantProvider } from "./lib/tenant.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <TenantProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </TenantProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);

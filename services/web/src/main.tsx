import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { PersonProvider } from "./person";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { registerServiceWorker } from "./push";
import { applyTheme, savedTheme } from "./theme";

applyTheme(savedTheme());
// retour dans l'app (PWA rouverte, onglet réaffiché) : on réapplique le choix mémorisé
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applyTheme(savedTheme()); });
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PersonProvider>
        <App />
      </PersonProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

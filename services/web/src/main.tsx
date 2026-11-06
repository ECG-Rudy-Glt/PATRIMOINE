import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { PersonProvider } from "./person";
import "./styles.css";
import { registerServiceWorker } from "./push";
import { applyTheme, savedTheme } from "./theme";

applyTheme(savedTheme());
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

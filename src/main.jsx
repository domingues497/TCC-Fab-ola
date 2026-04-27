import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "../germination-bi_4.jsx";
import "./main.css";

if (import.meta.env.PROD) {
  let updateSW = () => {};
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true);
    },
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

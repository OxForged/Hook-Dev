// SPDX-License-Identifier: MIT
/** Entry point. Applies the brand tokens, then mounts. */

import "@rainbow-me/rainbowkit/styles.css";
import "@latchprotocol/connect/styles.css";
import "@latchprotocol/widgets/styles.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyBrand } from "./theme";

applyBrand();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html is missing its #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

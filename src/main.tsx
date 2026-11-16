// first: the return from WHOOP is read from the URL before anything else looks at the hash
import "./lib/whoopReturn";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./space/tokens.css";
import "./space/space.css";
import "./time/time.css";
import "./places/places.css";
import "./space/unfold.css";
import "./space/tour.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

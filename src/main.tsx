import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n"; // initialises i18next before the first render

createRoot(document.getElementById("root")!).render(<App />);

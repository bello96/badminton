import { install } from "@twind/core";
import presetAutoprefix from "@twind/preset-autoprefix";
import presetTailwind from "@twind/preset-tailwind";
import { createRoot } from "react-dom/client";
import App from "./App";

install({
  presets: [presetAutoprefix(), presetTailwind()],
  theme: {
    extend: {
      colors: {
        primary: "#059669",
        "primary-dark": "#047857",
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(<App />);

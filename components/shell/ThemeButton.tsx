"use client";

import { useState } from "react";

const THEMES = ["auto", "dark", "light"] as const;
type Theme = (typeof THEMES)[number];

export function ThemeButton() {
  const [theme, setTheme] = useState<Theme>("auto");
  const next = () => {
    const chosen = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(chosen);
    if (chosen === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = chosen;
  };
  return (
    <button type="button" className="linkish" onClick={next}>
      Theme: {theme}
    </button>
  );
}

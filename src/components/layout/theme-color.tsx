"use client";
import { useEffect } from "react";
import { useTheme } from "next-themes";

/** Keeps the theme-color metas (rendered by Next from `viewport`) in sync with the chosen theme. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!resolvedTheme) return;
    const color = resolvedTheme === "dark" ? "#262624" : "#FAF9F5";
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = color;
    });
  }, [resolvedTheme]);
  return null;
}

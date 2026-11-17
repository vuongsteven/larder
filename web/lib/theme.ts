export type ThemePref = "system" | "light" | "dark";
const KEY = "larder.theme";

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  // Keep the browser chrome (status bar) in step with a manual override.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const isDarkTag = meta.media.includes("dark");
    if (pref === "system") meta.content = isDarkTag ? "#121311" : "#f6f4ef";
    else meta.content = pref === "dark" ? "#121311" : "#f6f4ef";
  }
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // ignore: applies for this session only
  }
  applyTheme(pref);
}

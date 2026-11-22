export const locales = ["en", "hi"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** Shown disabled in the language switcher ("Coming soon"). */
export const comingSoonLocales = ["मराठी", "தமிழ்", "తెలుగు", "ગુજરાતી", "বাংলা"];
export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (locales as readonly string[]).includes(v);
}

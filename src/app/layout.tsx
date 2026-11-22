import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const devanagari = localFont({
  src: [{ path: "./fonts/noto-sans-devanagari-devanagari-wght-normal.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-devanagari",
  display: "swap",
});

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "TArrow", template: "%s · TArrow" },
  description: "Pay all your vendors in one go.",
  applicationName: "TArrow",
  appleWebApp: { capable: true, title: "TArrow", statusBarStyle: "default" },
  openGraph: {
    title: "TArrow",
    description: "Pay all your vendors in one go.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F5" },
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${devanagari.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

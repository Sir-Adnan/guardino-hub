import "./../styles/globals.css";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/components/i18n-context";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  applicationName: "Guardino Hub",
  title: {
    default: "Guardino Hub",
    template: "%s | Guardino Hub",
  },
  description: "پنل مرکزی فروش، مدیریت رسیلرها و اشتراک‌های VPN",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Guardino",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#b40009" },
    { media: "(prefers-color-scheme: dark)", color: "#7f0006" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <I18nProvider>
              {children}
              <PwaRegister />
            </I18nProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

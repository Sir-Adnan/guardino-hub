import "./../styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/components/i18n-context";

export const metadata = {
  title: "Guardino Hub",
  description: "VPN reseller panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <I18nProvider>{children}</I18nProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

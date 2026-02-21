import "./../styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata = {
  title: "Guardino Hub",
  description: "VPN reseller panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

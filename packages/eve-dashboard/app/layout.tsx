import type { Metadata } from "next";
import { DM_Sans as DMSans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const dmSans = DMSans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eve Dashboard",
  description: "Your sovereign stack control panel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} dark`} suppressHydrationWarning>
      <body suppressHydrationWarning className="bg-background text-foreground min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import "./globals.css";
import { Oswald, Inter } from "next/font/google";

// Self-hosted via next/font — served from our own domain, so fonts load
// even for unauthorized captive-portal guests (no external CDN needed).
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata = {
  title: "Burger & Sauce | Free Guest WiFi",
  description:
    "Connect to free guest WiFi at Burger & Sauce. Fresh everyday, never frozen.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${oswald.variable} ${inter.variable}`}>
      <body className="bg-black text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

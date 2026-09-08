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

/*
 * Sets the admin theme before the browser paints, so the page never flashes
 * the wrong colour while React hydrates. No stored choice means follow the
 * operating system. The guest splash page ignores these tokens entirely —
 * it's always the branded light card — so running this everywhere is harmless.
 */
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('hg-admin-theme');
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${oswald.variable} ${inter.variable}`} data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-black text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

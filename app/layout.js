import "./globals.css";

export const metadata = {
  title: "HyperGlow Guest WiFi",
  description: "Connect to free guest WiFi powered by HyperGlow",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-night text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

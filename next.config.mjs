/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serve the app under a subpath, e.g. /SplashPage/BnS
  // Set NEXT_PUBLIC_BASE_PATH in .env (empty = serve at domain root).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;

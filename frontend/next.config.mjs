/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const brandHeaders = [
      { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
    ];
    const noStoreHeaders = [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    ];

    return [
      { source: "/sw.js", headers: noStoreHeaders },
      { source: "/manifest.webmanifest", headers: noStoreHeaders },
      { source: "/favicon.ico", headers: brandHeaders },
      { source: "/favicon-16x16.png", headers: brandHeaders },
      { source: "/favicon-32x32.png", headers: brandHeaders },
      { source: "/brand/:path*", headers: brandHeaders },
      { source: "/icons/:path*", headers: brandHeaders },
    ];
  },
};
export default nextConfig;

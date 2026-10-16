/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cashew/shared"],
  webpack: (config) => {
    // Optional deps pulled in by wallet SDKs that are irrelevant in the browser.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = { ...config.resolve.fallback, "@react-native-async-storage/async-storage": false };
    return config;
  },
};
export default nextConfig;

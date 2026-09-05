/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { dirs: ['src', 'scripts'] },
  webpack: (config) => {
    // @solana/web3.js v1 reaches for node builtins that have no browser equivalent.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false };
    return config;
  },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

module.exports = nextConfig;

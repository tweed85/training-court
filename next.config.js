/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'limitlesstcg.s3.us-east-2.amazonaws.com',
        port: '',
        pathname: '/**',
      },
      {
        // Card art served by the deckbuilder catalog.
        protocol: 'https',
        hostname: 'pkmn-tcg-api-images.sfo2.cdn.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig;

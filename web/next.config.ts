import type { NextConfig } from "next";

// ブラウザは同じオリジンの /api を呼び、Next.js が API_ORIGIN（Cloud Run）へ転送する。CORS は不要。
const apiOrigin = process.env.API_ORIGIN;
if (!apiOrigin) throw new Error("API_ORIGIN が未設定です（ローカルは .env.local、App Hosting は apphosting.<環境名>.yaml）");

const nextConfig: NextConfig = {
  ...(process.env.T167_NEXT_DIST_DIR === ".next-real" ? { distDir: ".next-real" } : {}),
  experimental: {
    // 録音の分析（POST /api/rooms/{部屋}/groups/recording）は数分かかる。転送の既定（30秒）で切らない。API 側の上限は5分
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [
      // 公開パスを保ち、Cloud Run の予約パス /healthz を避けて実 API に転送する。
      { source: "/api/healthz", destination: `${apiOrigin}/health` },
      { source: "/api/:path*", destination: `${apiOrigin}/:path*` },
    ];
  },
};

export default nextConfig;

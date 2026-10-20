import { cpSync, existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 外にデータを送れないようにする決まり（CSP）。通信は自分のサイトの中だけ。
 * 開発中は Vite の自動更新が動かなくなるので、出来上がり（build）にだけ入れる
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'fuseji-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

/** 日本語 PDF を読むための対応表を public/cmaps に写す（ネットを切っても PDF を読めるように同梱する） */
function copyCmaps(): Plugin {
  return {
    name: 'fuseji-cmaps',
    buildStart() {
      if (!existsSync('public/cmaps')) cpSync('node_modules/pdfjs-dist/cmaps', 'public/cmaps', { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    copyCmaps(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'ふせじ — AIに渡す前に個人情報をかくす',
        short_name: 'ふせじ',
        description: '文章・PDF・Word の名前や番号を記号に置き換えてから AI に渡し、返事を元の名前に戻す。処理はこの端末の中だけ。',
        lang: 'ja',
        start_url: './',
        display: 'standalone',
        background_color: '#f6f5f1',
        theme_color: '#2f5d50',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // 画面・部品・PDF の対応表まで全部を端末に入れておき、ネットなしで動かす
        globPatterns: ['**/*.{html,js,mjs,css,svg,webmanifest,bcmap}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});

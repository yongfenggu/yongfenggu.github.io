/*
 * Service Worker —— pages/ 目录下所有小应用的共享离线缓存
 *
 * 放置位置：pages/sw.js（作用域 scope = pages/，可缓存该目录下所有子路径资源）
 *
 * 缓存两类资源：
 *   1) 同源资源（pages/ 下的 HTML/JS/图片等）—— Stale-While-Revalidate + 离线兜底
 *   2) 指定 CDN 上的第三方库（three.js / html2canvas / jsPDF）—— Cache-First
 *      这样这些库不必内置到仓库，联网加载一次后离线也能用。
 *
 * 每个页面用一小段脚本注册本 SW：
 *   - pages/ 根目录的页面：navigator.serviceWorker.register('./sw.js')
 *   - pages/xxx/ 子目录的页面：navigator.serviceWorker.register('../sw.js')
 * 注意：注册路径决定 scope 上限，SW 文件必须位于 pages/ 根，才能覆盖全部子应用。
 *
 * 如需强制刷新所有缓存，修改下面的 CACHE_VERSION 即可。
 */

const CACHE_VERSION = 'pages-cache-v1';   // 同源资源缓存桶
const CDN_CACHE = 'pages-cdn-libs-v1';    // 第三方 CDN 库缓存桶（版本固定，很少变动）

// 允许缓存的 CDN 域名（这些是页面里 three.js / html2canvas / jsPDF 的回退来源）
const CDN_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

self.addEventListener('install', (event) => {
  // 不预缓存具体清单，改为运行时按需缓存（各应用文件差异大，避免维护列表）
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  const keep = [CACHE_VERSION, CDN_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // —— 分支 1：指定 CDN 上的第三方库（跨域）——
  // 采用 Cache-First：命中缓存直接返回；未命中则由 SW 主动发一个 CORS 请求，
  // 拿到可缓存的完整响应后存入 CDN 缓存桶，之后离线也能用。
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          // cors 模式确保响应可缓存（避免 opaque 响应体不可用）
          return fetch(req.url, { mode: 'cors', credentials: 'omit' })
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached || Response.error());
        })
      )
    );
    return;
  }

  // —— 分支 2：同源且在本 SW 作用域（pages/）内的资源 ——
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL('./', self.location).pathname; // 形如 /pages/
  if (!url.pathname.startsWith(scopePath)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        // 后台联网更新缓存
        const networkFetch = fetch(req)
          .then((res) => {
            // 只缓存正常的同源响应（basic），跳过 opaque / 错误响应
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => null);

        // 有缓存先返回缓存；否则等网络
        if (cached) return cached;

        return networkFetch.then((res) => {
          if (res) return res;
          // 网络也失败：导航请求兜底到同目录 index.html
          if (req.mode === 'navigate') {
            const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
            return cache.match(dir + 'index.html')
              .then((fallback) => fallback || cache.match(dir) || Response.error());
          }
          return Response.error();
        });
      })
    )
  );
});

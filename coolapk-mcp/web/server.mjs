/**
 * 酷安舆论监测 · 服务端（ESM + 本地模型情感分析）
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CoolapkAPI = require('../src/index');
const store = require('../src/store');
import { init as initSentiment, analyzeBatch, isReady } from '../src/sentiment.mjs';

const api = new CoolapkAPI({ rateLimit: true });
api.limiter.minInterval = 2000;
api.limiter.maxInterval = 4000;
api.limiter.maxPerMinute = 12;
api.limiter.burstLimit = 30;

const PORT = 3000;

// 预加载模型
initSentiment().catch(e => console.error('模型加载失败:', e.message));

// 后台刷新队列
const refreshQueue = new Set();
async function bgRefresh(type, params, fetcher) {
  const key = `${type}:${JSON.stringify(params)}`;
  if (refreshQueue.has(key)) return;
  refreshQueue.add(key);
  try { const d = await fetcher(); store.set(type, params, d); } catch {}
  finally { refreshQueue.delete(key); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    const p = url.searchParams;
    try {
      let data, fromCache = false, stale = false;

      switch (url.pathname) {
        case '/api/search/all': {
          const params = { q: p.get('q'), sort: p.get('sort') || 'default', pages: p.get('pages') || '3' };
          const cached = store.get('search', params);
          if (cached) {
            data = cached.data;
            fromCache = true; stale = !cached.fresh;
            if (stale) bgRefresh('search', params, () => api.searchAll(params.q, { type: 'feed', maxPages: Math.min(parseInt(params.pages), 5), sort: params.sort }));
          } else {
            data = await api.searchAll(params.q, { type: 'feed', maxPages: Math.min(parseInt(params.pages), 5), sort: params.sort });
            store.set('search', params, data);
          }
          break;
        }
        case '/api/feed/replies': {
          const params = { id: p.get('id') };
          const cached = store.get('comments', params);
          if (cached) { data = cached.data; fromCache = true; stale = !cached.fresh; if (stale) bgRefresh('comments', params, () => api.feedReplies(params.id, 1, 'hot')); }
          else { data = await api.feedReplies(params.id, parseInt(p.get('page')) || 1, p.get('sort') || 'hot'); store.set('comments', params, data); }
          break;
        }
        case '/api/sentiment': {
          // 批量情感分析
          const texts = JSON.parse(await new Promise((resolve) => { let body = ''; req.on('data', c => body += c); req.on('end', () => resolve(body)); }));
          if (!isReady()) { data = { ready: false, message: '模型加载中...' }; }
          else { data = await analyzeBatch(texts); }
          break;
        }
        case '/api/stats':
          data = { rateLimit: api.getRateLimitStats(), store: store.stats(), devicePool: api.getDevicePoolStats(), modelReady: isReady() };
          break;
        default:
          data = { error: 'Unknown endpoint' };
      }
      res.end(JSON.stringify({ ok: true, data, _cache: fromCache, _stale: stale }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

const cleaned = store.cleanup();
server.listen(PORT, () => {
  console.log(`🔍 酷安舆论监测: http://localhost:${PORT}`);
  console.log(`   防爬: 2-4s间隔 | 12次/分 | 指数退避`);
  console.log(`   缓存: 已存${store.stats().totalItems}条`);
  console.log(`   模型: distilbert-multilingual (2ms/条)`);
});

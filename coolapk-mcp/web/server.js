/**
 * 酷安舆论监测工具 · 服务端
 *
 * 特性：
 * - 防爬限速（2-4s 随机间隔 / 12次每分钟 / 指数退避）
 * - 数据持久化（搜索缓存 30 分钟 / 评论缓存 2 小时）
 * - stale-while-revalidate：过期数据先返回，后台刷新
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const CoolapkAPI = require('../src/index');
const store = require('../src/store');

const api = new CoolapkAPI({ rateLimit: true });
api.limiter.minInterval = 2000;
api.limiter.maxInterval = 4000;
api.limiter.maxPerMinute = 12;
api.limiter.burstLimit = 30;

const PORT = 3000;

// 后台刷新队列（stale-while-revalidate）
const refreshQueue = new Set();

async function backgroundRefresh(type, params, fetcher) {
  const key = `${type}:${JSON.stringify(params)}`;
  if (refreshQueue.has(key)) return; // 已在刷新
  refreshQueue.add(key);
  try {
    const freshData = await fetcher();
    store.set(type, params, freshData);
  } catch (e) {
    // 静默失败（风控等），保留旧缓存
  } finally {
    refreshQueue.delete(key);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    const p = url.searchParams;

    try {
      let data, fromCache = false, stale = false;

      switch (url.pathname) {
        case '/api/search/all': {
          const params = { q: p.get('q'), sort: p.get('sort') || 'default', pages: p.get('pages') || '3' };
          const cached = store.get('search', params);

          if (cached) {
            data = cached.data;
            fromCache = true;
            stale = !cached.fresh;
            // 过期则后台刷新
            if (stale) {
              backgroundRefresh('search', params, async () => {
                return api.searchAll(params.q, {
                  type: 'feed',
                  maxPages: Math.min(parseInt(params.pages), 5),
                  sort: params.sort,
                });
              });
            }
          } else {
            data = await api.searchAll(params.q, {
              type: 'feed',
              maxPages: Math.min(parseInt(params.pages), 5),
              sort: params.sort,
            });
            store.set('search', params, data);
          }
          break;
        }

        case '/api/feed/replies': {
          const params = { id: p.get('id') };
          const cached = store.get('comments', params);

          if (cached) {
            data = cached.data;
            fromCache = true;
            stale = !cached.fresh;
            if (stale) {
              backgroundRefresh('comments', params, () =>
                api.feedReplies(params.id, 1, p.get('sort') || 'hot')
              );
            }
          } else {
            data = await api.feedReplies(params.id, parseInt(p.get('page')) || 1, p.get('sort') || 'hot');
            store.set('comments', params, data);
          }
          break;
        }

        case '/api/search':
          data = await api.search(p.get('q') || '', p.get('type') || 'feed', parseInt(p.get('page')) || 1, p.get('sort') || 'default');
          break;
        case '/api/feed':
          data = await api.feedDetail(p.get('id'));
          break;
        case '/api/user':
          data = await api.userProfile(p.get('uid'));
          break;
        case '/api/index':
          data = await api.indexV8(parseInt(p.get('page')) || 1);
          break;
        case '/api/topic':
          data = await api.topicDetail(p.get('tag'));
          break;
        case '/api/stats':
          data = { rateLimit: api.getRateLimitStats(), store: store.stats(), devicePool: api.getDevicePoolStats() };
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

  res.writeHead(404);
  res.end('Not Found');
});

// 启动时清理过期缓存
const cleaned = store.cleanup();
const stats = store.stats();

server.listen(PORT, () => {
  console.log(`🔍 酷安舆论监测: http://localhost:${PORT}`);
  console.log(`   防爬: 2-4s间隔 | 12次/分 | 指数退避`);
  console.log(`   缓存: 搜索30min | 评论2h | 已存${stats.totalItems}条`);
  if (cleaned) console.log(`   清理: ${cleaned} 条过期缓存`);
});

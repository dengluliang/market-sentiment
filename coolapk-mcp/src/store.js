/**
 * 数据持久化存储
 *
 * 策略：
 * - 搜索结果按关键词+排序方式缓存
 * - 评论按帖子 ID 缓存
 * - 缓存有效期：搜索结果 30 分钟，评论 2 小时
 * - 超时后标记为 stale，返回缓存同时后台刷新
 * - 存储为 JSON 文件（data/ 目录）
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, '_index.json');

// 缓存有效期（毫秒）
const TTL = {
  search: 30 * 60 * 1000,     // 搜索结果 30 分钟
  comments: 2 * 60 * 60 * 1000, // 评论 2 小时
  feed: 4 * 60 * 60 * 1000,     // 帖子详情 4 小时
};

class Store {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.index = this._loadIndex();
  }

  _loadIndex() {
    try {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    } catch {
      return { searches: {}, comments: {}, feeds: {} };
    }
  }

  _saveIndex() {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
  }

  _key(type, params) {
    if (type === 'search') return `s_${params.q}_${params.sort}_${params.pages}`;
    if (type === 'comments') return `c_${params.id}`;
    if (type === 'feed') return `f_${params.id}`;
    return `x_${JSON.stringify(params)}`;
  }

  _filePath(key) {
    // 安全文件名
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    return path.join(DATA_DIR, safe + '.json');
  }

  /**
   * 获取缓存
   * @returns {{ data, fresh, age, cachedAt }} 或 null
   */
  get(type, params) {
    const key = this._key(type, params);
    const meta = this.index[type + 's']?.[key];
    if (!meta) return null;

    const file = this._filePath(key);
    if (!fs.existsSync(file)) return null;

    const age = Date.now() - meta.cachedAt;
    const ttl = TTL[type] || TTL.search;
    const fresh = age < ttl;

    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { data, fresh, age, cachedAt: meta.cachedAt, count: meta.count };
    } catch {
      return null;
    }
  }

  /**
   * 写入缓存
   */
  set(type, params, data) {
    const key = this._key(type, params);
    const file = this._filePath(key);
    const now = Date.now();

    fs.writeFileSync(file, JSON.stringify(data));

    if (!this.index[type + 's']) this.index[type + 's'] = {};
    this.index[type + 's'][key] = {
      cachedAt: now,
      count: Array.isArray(data) ? data.length : 1,
      params,
    };
    this._saveIndex();
  }

  /**
   * 获取统计信息
   */
  stats() {
    const searches = Object.keys(this.index.searchs || {}).length;
    const comments = Object.keys(this.index.commentss || {}).length;
    const feeds = Object.keys(this.index.feeds || {}).length;

    // 计算总数据量
    let totalItems = 0;
    for (const meta of Object.values(this.index.searchs || {})) totalItems += meta.count || 0;
    for (const meta of Object.values(this.index.commentss || {})) totalItems += meta.count || 0;

    return { searches, comments, feeds, totalItems };
  }

  /**
   * 清理过期缓存（超过 24 小时的全部删除）
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [type, entries] of Object.entries(this.index)) {
      if (typeof entries !== 'object') continue;
      for (const [key, meta] of Object.entries(entries)) {
        if (now - meta.cachedAt > maxAge) {
          const file = this._filePath(key);
          try { fs.unlinkSync(file); } catch {}
          delete entries[key];
          cleaned++;
        }
      }
    }

    if (cleaned > 0) this._saveIndex();
    return cleaned;
  }
}

module.exports = new Store();

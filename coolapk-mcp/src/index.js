/**
 * 酷安 API SDK
 * 内置：防爬限速 + 设备指纹轮换 + 缓存
 */

const fetch = require('node-fetch');
const { generateToken } = require('./token_v3');
const RateLimiter = require('./rate-limiter');
const DevicePool = require('./device-pool');

const DEFAULT_CONFIG = {
  baseUrl: 'https://api.coolapk.com',
  appVersion: '16.2.2',
  appCode: 2605201,
  apiVersion: '16',
  sdkInt: '36',
  userAgent: 'Dalvik/2.1.0 (Linux; U; Android 16; 25098PN5AC Build/BP2A.250605.031.A3) (#Build; Xiaomi; 25098PN5AC; BP2A.250605.031.A3 test-keys; HyperOS_3.0; 3.0.260310.1) +CoolMarket/16.2.2-2605201-universal',
  rateLimit: true,
  devicePoolSize: 10,  // 指纹池大小
};

class CoolapkAPI {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.limiter = new RateLimiter();
    this.devicePool = new DevicePool(this.config.devicePoolSize);
    this._currentDevice = null;
  }

  _getHeaders(deviceId) {
    const token = generateToken(deviceId, this.config.appCode);
    return {
      'User-Agent': this.config.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Sdk-Int': this.config.sdkInt,
      'X-Sdk-Locale': 'zh-CN',
      'X-App-Id': 'com.coolapk.market',
      'X-App-Token': token,
      'X-App-Version': this.config.appVersion,
      'X-App-Code': String(this.config.appCode),
      'X-Api-Version': this.config.apiVersion,
      'X-App-Device': deviceId,
      'X-Dark-Mode': '0',
      'X-App-Channel': 'coolapk',
      'X-App-Mode': 'universal',
      'X-App-Supported': String(this.config.appCode),
    };
  }

  async request(path, params = {}, { retryWithNewDevice = true } = {}) {
    if (this.config.rateLimit) await this.limiter.acquire();

    // 选择设备
    const device = this.devicePool.next();
    this._currentDevice = device;
    const deviceId = device.id;

    const url = new URL(path, this.config.baseUrl);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    const res = await fetch(url.toString(), { headers: this._getHeaders(deviceId) });
    const json = await res.json();

    // 风控检测
    if (json.messageStatus === 'err_request_captcha_v2' || res.status === 429) {
      this.devicePool.markBlocked(deviceId);
      this.limiter.backoff();

      // 用新设备重试一次
      if (retryWithNewDevice) {
        return this.request(path, params, { retryWithNewDevice: false });
      }
      throw new Error(`[风控] ${json.message || 'captcha required'}`);
    }

    if (json.data !== undefined) {
      this.devicePool.markSuccess(deviceId);
      this.limiter.reset();
      return json.data;
    }

    // 其他错误不标记 blocked
    throw new Error(json.message || `HTTP ${res.status}`);
  }

  getRateLimitStats() { return this.limiter.getStats(); }
  getDevicePoolStats() { return this.devicePool.stats(); }

  // === 搜索 ===
  async search(keyword, type = 'feed', page = 1, sort = 'default') {
    return this.request('/v6/search', { searchValue: keyword, type, page, sort });
  }
  // === 帖子 ===
  async feedDetail(id) { return this.request('/v6/feed/detail', { id }); }
  async feedReplies(id, page = 1, sort = 'hot') {
    const listType = sort === 'hot' ? 'lastupdate_desc' : 'dateline_desc';
    return this.request('/v6/feed/replyList', { id, page, sort: sort === 'hot' ? 'default' : sort, listType });
  }
  // 评论的子回复
  async replyDetail(id, page = 1) { return this.request('/v6/feed/replyDetail', { id, page }); }
  // === 热榜（首页多页聚合） ===
  async hotList(pages = 3) {
    let all = [];
    for (let p = 1; p <= pages; p++) {
      try {
        const data = await this.indexV8(p);
        const feeds = data.filter(item => item.entityType === 'feed');
        all.push(...feeds);
      } catch { break; }
    }
    all.sort((a, b) => (b.likenum || 0) - (a.likenum || 0));
    return all;
  }
  async topicHot(page = 1) { return this.request('/v6/page/dataList', { url: '#/topic/hotTagList', page }); }
  // === 首页 ===
  async mainInit() { return this.request('/v6/main/init'); }
  async indexV8(page = 1) { return this.request('/v6/main/indexV8', { page, firstLaunch: '0', installTime: '' }); }
  async hotPictures(page = 1) { return this.request('/v6/page/dataList', { url: '#/feed/coolPictureList', page }); }
  // === 用户 ===
  async userProfile(uid) { return this.request('/v6/user/profile', { uid }); }
  async userFeed(uid, page = 1) { return this.request('/v6/user/feedList', { uid, page }); }
  // === 话题 ===
  async topicDetail(tag) { return this.request('/v6/topic/tagDetail', { tag }); }
  async topicFeeds(tag, page = 1, sort = 'hot') {
    return this.request('/v6/topic/tagFeedList', { tag, page, sort: sort === 'hot' ? 'default' : 'dateline_desc' });
  }
  // === 批量搜索 ===
  async searchAll(keyword, { type = 'feed', maxPages = 5, sort = 'default' } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const items = await this.search(keyword, type, page, sort);
        if (!items.length) break;
        all.push(...items);
      } catch (e) {
        if (e.message.includes('风控')) break;
        throw e;
      }
    }
    return all;
  }
}

module.exports = CoolapkAPI;

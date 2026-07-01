/**
 * 防爬策略模块
 *
 * 策略：
 * 1. 请求间隔：每次请求间隔 1.5-3.5 秒（随机）
 * 2. 并发控制：同一时间最多 1 个请求（串行）
 * 3. 退避机制：遇到风控（验证码/429）自动指数退避
 * 4. 请求上限：每分钟最多 15 次请求
 * 5. 自动休息：连续请求 50 次后休息 30-60 秒
 */

class RateLimiter {
  constructor(opts = {}) {
    this.minInterval = opts.minInterval || 1500;   // 最小间隔 ms
    this.maxInterval = opts.maxInterval || 3500;   // 最大间隔 ms
    this.maxPerMinute = opts.maxPerMinute || 15;   // 每分钟上限
    this.burstLimit = opts.burstLimit || 50;       // 连续请求上限
    this.cooldownMin = opts.cooldownMin || 30000;  // 冷却最短 ms
    this.cooldownMax = opts.cooldownMax || 60000;  // 冷却最长 ms

    this.lastRequest = 0;
    this.requestCount = 0;
    this.minuteRequests = [];
    this.backoffMs = 0;
    this.queue = Promise.resolve();
  }

  _randomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _cleanMinuteWindow() {
    const now = Date.now();
    this.minuteRequests = this.minuteRequests.filter(t => now - t < 60000);
  }

  async acquire() {
    // 串行排队
    const ticket = this.queue.then(async () => {
      // 退避
      if (this.backoffMs > 0) {
        await this._sleep(this.backoffMs);
        this.backoffMs = 0;
      }

      // 连续请求后冷却
      if (this.requestCount > 0 && this.requestCount % this.burstLimit === 0) {
        const cooldown = this._randomDelay(this.cooldownMin, this.cooldownMax);
        await this._sleep(cooldown);
      }

      // 每分钟上限
      this._cleanMinuteWindow();
      if (this.minuteRequests.length >= this.maxPerMinute) {
        const waitUntil = this.minuteRequests[0] + 60000;
        const waitMs = waitUntil - Date.now();
        if (waitMs > 0) await this._sleep(waitMs);
      }

      // 随机间隔
      const elapsed = Date.now() - this.lastRequest;
      const interval = this._randomDelay(this.minInterval, this.maxInterval);
      if (elapsed < interval) {
        await this._sleep(interval - elapsed);
      }

      this.lastRequest = Date.now();
      this.minuteRequests.push(this.lastRequest);
      this.requestCount++;
    });

    this.queue = ticket;
    return ticket;
  }

  // 遇到风控时调用
  backoff() {
    this.backoffMs = Math.max(this.backoffMs * 2, 10000); // 最少 10s，指数增长
    if (this.backoffMs > 300000) this.backoffMs = 300000;  // 最大 5 分钟
  }

  reset() {
    this.backoffMs = 0;
  }

  getStats() {
    this._cleanMinuteWindow();
    return {
      totalRequests: this.requestCount,
      requestsThisMinute: this.minuteRequests.length,
      backoffMs: this.backoffMs,
      nextBurst: this.burstLimit - (this.requestCount % this.burstLimit),
    };
  }
}

module.exports = RateLimiter;

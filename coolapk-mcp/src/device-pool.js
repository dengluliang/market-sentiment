/**
 * 设备指纹池 + 轮换策略
 *
 * 原理：
 * - X-App-Device 是 base64 编码的设备信息（倒序）
 * - 酷安根据这个值识别"设备"，新设备首次请求敏感接口触发验证码
 * - 一旦某个指纹"通过"了（返回正常数据），就被信任
 * - 被风控的指纹进入冷却，之后换一个
 *
 * 策略：
 * - 生成多个随机但格式合法的设备指纹
 * - 正常响应 → 标记为 trusted，优先使用
 * - 触发验证码 → 标记为 blocked，冷却 30 分钟后重试
 * - 轮换使用，分散请求到不同指纹
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const POOL_FILE = path.join(__dirname, '..', 'data', '_device_pool.json');

// 生成随机 Android 设备信息，编码为酷安格式的 X-App-Device
function generateDeviceId() {
  // 设备信息字段（参考酷安的 170 字符格式）
  const brands = ['Xiaomi', 'Redmi', 'POCO', 'OnePlus', 'Samsung', 'OPPO', 'vivo', 'Huawei', 'Realme', 'iQOO'];
  const models = [
    '2201123C', '23013RK75C', '22041211AC', '2206123SC', 'M2012K11AC',
    '21091116AC', '2203121C', '23049RAD8C', '22081212C', '2211133C',
    '23078RKD5C', '24031PN0DC', '2304FPN6DC', '24053PY09C', '25098PN5AC',
  ];
  const brand = brands[Math.floor(Math.random() * brands.length)];
  const model = models[Math.floor(Math.random() * models.length)];
  const androidId = crypto.randomBytes(8).toString('hex');
  const mac = Array.from({length: 6}, () => crypto.randomBytes(1).toString('hex')).join(':');
  const imei = Array.from({length: 15}, () => Math.floor(Math.random() * 10)).join('');
  const serial = crypto.randomBytes(8).toString('hex').toUpperCase();
  const sdkInt = [33, 34, 35, 36][Math.floor(Math.random() * 4)];
  const buildId = ['TP1A.220624.014', 'TKQ1.220807.001', 'UP1A.231005.007', 'BP2A.250605.031'][Math.floor(Math.random() * 4)];

  // 组装成酷安的设备信息字符串（分号分隔的字段列表）
  const fields = [
    brand, model, serial, androidId, '', '', mac, imei, '',
    buildId, String(sdkInt), '', '1220x2656', '440', '', '', '', '', '', '', ''
  ];

  // 编码：base64(字段join) 然后 reverse
  const raw = fields.join(';');
  const b64 = Buffer.from(raw).toString('base64');
  // 酷安的格式是倒序的 base64
  const reversed = b64.split('').reverse().join('');

  // 确保长度约 170 字符（不够就 pad）
  let deviceId = reversed;
  while (deviceId.length < 170) {
    deviceId += crypto.randomBytes(1).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  }
  return deviceId.substring(0, 170);
}

class DevicePool {
  constructor(size = 10) {
    this.poolSize = size;
    this.pool = this._load();
    if (this.pool.length < size) this._expand(size);
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
      return data.devices || [];
    } catch {
      return [];
    }
  }

  _save() {
    const dir = path.dirname(POOL_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(POOL_FILE, JSON.stringify({ devices: this.pool, updatedAt: Date.now() }, null, 2));
  }

  _expand(targetSize) {
    while (this.pool.length < targetSize) {
      this.pool.push({
        id: generateDeviceId(),
        status: 'fresh',     // fresh | trusted | blocked
        lastUsed: 0,
        blockedAt: 0,
        successCount: 0,
        failCount: 0,
      });
    }
    this._save();
  }

  /**
   * 获取下一个可用设备
   * 优先级：trusted > fresh > 冷却结束的 blocked
   */
  next() {
    const now = Date.now();
    const COOLDOWN = 30 * 60 * 1000; // 30 分钟冷却

    // 解冻超时的
    this.pool.forEach(d => {
      if (d.status === 'blocked' && now - d.blockedAt > COOLDOWN) {
        d.status = 'fresh';
      }
    });

    // 优先 trusted（按 lastUsed 最旧的）
    const trusted = this.pool.filter(d => d.status === 'trusted').sort((a, b) => a.lastUsed - b.lastUsed);
    if (trusted.length) {
      trusted[0].lastUsed = now;
      this._save();
      return trusted[0];
    }

    // 然后 fresh
    const fresh = this.pool.filter(d => d.status === 'fresh').sort((a, b) => a.lastUsed - b.lastUsed);
    if (fresh.length) {
      fresh[0].lastUsed = now;
      this._save();
      return fresh[0];
    }

    // 都被 block 了，用等待时间最久的
    const blocked = this.pool.filter(d => d.status === 'blocked').sort((a, b) => a.blockedAt - b.blockedAt);
    if (blocked.length) {
      blocked[0].lastUsed = now;
      blocked[0].status = 'fresh'; // 强制解冻
      this._save();
      return blocked[0];
    }

    // 兜底：新生成一个
    this._expand(this.pool.length + 1);
    return this.pool[this.pool.length - 1];
  }

  /**
   * 标记成功（变 trusted）
   */
  markSuccess(deviceId) {
    const d = this.pool.find(x => x.id === deviceId);
    if (d) {
      d.status = 'trusted';
      d.successCount++;
      this._save();
    }
  }

  /**
   * 标记被风控（变 blocked）
   */
  markBlocked(deviceId) {
    const d = this.pool.find(x => x.id === deviceId);
    if (d) {
      d.status = 'blocked';
      d.blockedAt = Date.now();
      d.failCount++;
      this._save();
    }
  }

  /**
   * 池子状态
   */
  stats() {
    return {
      total: this.pool.length,
      trusted: this.pool.filter(d => d.status === 'trusted').length,
      fresh: this.pool.filter(d => d.status === 'fresh').length,
      blocked: this.pool.filter(d => d.status === 'blocked').length,
    };
  }
}

module.exports = DevicePool;

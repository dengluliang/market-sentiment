/**
 * 酷安 API Token v3 生成算法
 *
 * 逆向自酷安 v16.2.2 (versionCode=2605201)
 * 通过 JDWP 调试从 ClientInterceptor.intercept() 中抓取真实请求 headers 验证
 *
 * 关键参数:
 * - bcrypt cost: 04 (之前的开源实现用的是 10，导致 403)
 * - hash variant: $2y (但 bcryptjs 生成 $2a，需要手动替换前缀)
 * - SOURCE_STRING: 930 字符的 base64 编码字符串
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// bcrypt 自定义字符集
const BCRYPT_CHARS = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// SOURCE_STRING (从 APK 中提取，XOR 0x5A 解密)
const SOURCE_STRING = 'TTBUOFQsQ0ElLUMkWDEjQSEsUyEmLDNAUy1DPFYuIy0iMUM5IzBUJFctMykhMUQ1JS1DOSUxMzhQLVMwV00sIyhSMTQsWTFDRFEwQ0RVMSQkUS0jKSMtJDhYLVQkUjEzKSQsM0BVLTQwUi00NSMsM2BXLVMlJC1DNFlNLCQ0WTEzLSQxQ0EhLEMlIjEzKFcwMz0lLiNEVzEjPSYuNDkkLFMwVixTKFktQzhXLFMsWC4jLSYtU2BTTTA0LFEuMzhTLjMhIjFDMFMsI0BVLCQkUCwzJSIsIzBSMEM8UCxELSItI2BQLUQoUy0jLFMsIyUkMFQwVk0tRCxYMTMlJC40NSEwU0RQLFMhIi0kNSMwU2BQLjNgUywjOFEsNCxTLEMwWCxULSEtIyRTLDNBIy00JFZNMUMsUDBEJFgtNC0kLDQkWC1DMFMxRCkjLVM0VixTMFgxIy0mLVMxJS0zJFQxM2BQLSQ4WTBDMFMuI0UhTSwzPFgtRDBRMDNEUS0jOFYuJDklMSQ0UzAzNSMwRDkkMTMkVSxUMFQtRCxYMTNFIyxELFYsIzUhLiQ0V00xNCxVLCM0Vy4zJFUxNCxTLFQ4Vy4jYFYxJDUjLUMwUzFDPFIsM0ElLDMsVDA0OSMuNCkmLEQkVixEMSJNLTMoUiwzLFctU0RQLiQwVTFDJSUwUykjMUMhIy0zISUsI0EjMTMwUS1UNFcxRDElLUQtJS4kNFIsIzhZTTBTYFEwQyRYLSMlIS40LFgsVDRZLUQoWTBDQFYtRCxWLjNEVDBDMFktNDUlLFQ4VS1UJFgwMzRWLDQ4UU0wQy0mLUQ4WS1TMSMsUyUiMUNAUSxULFYuI0RULiMsWDFELFMxI2BQLVM0WS4kOFcwM0RXLVMoWC0jKFExLCM0VixTNFAtRDRWLUQlJC1TJFAwNCxgYA';

const PACKAGE_NAME = 'com.coolapk.market';
const BCRYPT_COST = 4; // 关键：酷安 v16 改成了 04

function bcryptDecode(str) {
  const result = [];
  for (let i = 0; i < str.length; i += 4) {
    const b = [];
    for (let k = 0; k < 4 && (i + k) < str.length; k++) {
      b.push(BCRYPT_CHARS.indexOf(str[i + k]));
    }
    if (b.length >= 2) result.push((b[0] << 2) | (b[1] >> 4));
    if (b.length >= 3) result.push(((b[1] & 0xf) << 4) | (b[2] >> 2));
    if (b.length >= 4) result.push(((b[2] & 0x3) << 6) | b[3]);
  }
  return Buffer.from(result);
}

function bcryptEncode(buf) {
  let result = '', i = 0;
  while (i < buf.length) {
    let b1 = buf[i++] & 0xff;
    result += BCRYPT_CHARS[(b1 >> 2) & 0x3f];
    b1 = (b1 & 0x03) << 4;
    if (i >= buf.length) { result += BCRYPT_CHARS[b1 & 0x3f]; break; }
    let b2 = buf[i++] & 0xff;
    b1 |= (b2 >> 4) & 0x0f;
    result += BCRYPT_CHARS[b1 & 0x3f];
    b1 = (b2 & 0x0f) << 2;
    if (i >= buf.length) { result += BCRYPT_CHARS[b1 & 0x3f]; break; }
    let b3 = buf[i++] & 0xff;
    b1 |= (b3 >> 6) & 0x03;
    result += BCRYPT_CHARS[b1 & 0x3f];
    result += BCRYPT_CHARS[b3 & 0x3f];
  }
  return result;
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * 生成酷安 v3 token
 * @param {string} deviceId - X-App-Device 值 (170 字符)
 * @param {number} appVersion - versionCode (如 2605201)
 * @param {number} [timestamp] - Unix 时间戳（秒），默认当前时间
 * @returns {string} 完整的 X-App-Token 值
 */
function generateToken(deviceId, appVersion, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);

  // 1. 从 SOURCE_STRING 中提取子串
  const magic = 4 * ((ts + appVersion) % 100) + 128;
  let offset = 930 - magic;
  if (offset >= 0x80) offset = 128;
  const substring = SOURCE_STRING.substring(magic, magic + offset);
  const decoded = Buffer.from(substring, 'base64').toString();

  // 2. 构建 combine 字符串
  const deviceMd5 = md5(deviceId);
  const combine = `${PACKAGE_NAME}&${decoded}&${deviceMd5}&${ts}&${appVersion}`;

  // 3. 计算 MD5
  const encoded = Buffer.from(combine).toString('base64');
  const messageEncoded = md5(encoded);  // 用于 bcrypt 输入
  const messageCombine = md5(combine);  // 用于 salt 生成

  // 4. 生成 bcrypt salt
  const hexTimestamp = ts.toString(16);
  const saltInput = Buffer.from(`${hexTimestamp}/${messageCombine}`).toString('base64').replace(/=+$/, '');
  const saltPart = saltInput.substring(0, 22);
  const rawSalt = bcryptDecode(saltPart);
  const finalSalt = bcryptEncode(rawSalt.slice(0, 16)).substring(0, 22);

  // 5. bcrypt 加密 (cost=04)
  const costStr = BCRYPT_COST.toString().padStart(2, '0');
  const hash = bcrypt.hashSync(messageEncoded, `$2a$${costStr}$${finalSalt}`);

  // 6. 替换 $2a 为 $2y 并 base64 编码
  const hashY = '$2y' + hash.substring(3);
  return 'v3' + Buffer.from(hashY).toString('base64').replace(/=+$/, '');
}

module.exports = { generateToken, SOURCE_STRING, BCRYPT_COST };

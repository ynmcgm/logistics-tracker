/**
 * Session 管理器
 *
 * 职责:
 *  1. 加密存储第三方平台 cookie 到云数据库
 *  2. 从加密字符串恢复登录态
 *  3. 验证 cookie 有效性
 */

import crypto from 'node:crypto';

// AES-256-CBC 加密配置
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * 获取加密密钥（从环境变量读取）
 * 开发环境使用默认密钥
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (key) {
    // 确保密钥是 32 字节
    return crypto.createHash('sha256').update(key).digest();
  }
  // 开发环境默认密钥（仅用于开发！）
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return crypto.createHash('sha256').update('dev-key-32bytes!!!!!').digest();
  }
  throw new Error('ENCRYPTION_KEY environment variable is required');
}

/**
 * 加密 cookie 数据
 * @param {string} text - JSON 序列化的 cookie 字符串
 * @returns {string} base64 编码的加密结果 (iv:ciphertext)
 */
export function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * 解密 cookie 数据
 * @param {string} encryptedText - encrypt() 的输出
 * @returns {string} JSON 序列化的 cookie 字符串
 */
export function decrypt(encryptedText) {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * 保存 cookie 到数据存储
 *
 * @param {object} db - 数据库对象
 * @param {string} userId - 用户 openid
 * @param {string} platform - 平台标识
 * @param {import('playwright').Cookie[]} cookies - cookie 数组
 */
export async function saveSession(db, userId, platform, cookies) {
  const cookieStr = JSON.stringify(cookies);
  const encrypted = encrypt(cookieStr);

  const record = {
    user_openid: userId,
    platform,
    status: 'active',
    cookies_encrypted: encrypted,
    last_verified: new Date(),
    created_at: new Date(),
    fail_count: 0,
  };

  // upsert: 存在则更新，不存在则创建
  await db.collection('sessions').updateOne(
    { user_openid: userId, platform },
    { $set: record, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );
}

/**
 * 从数据存储加载并解密 cookie
 *
 * @param {object} db - 数据库对象
 * @param {string} userId - 用户 openid
 * @param {string} platform - 平台标识
 * @returns {Promise<{ cookies: import('playwright').Cookie[], session: object } | null>}
 */
export async function loadSession(db, userId, platform) {
  const session = await db.collection('sessions').findOne({
    user_openid: userId,
    platform,
    status: 'active',
  });

  if (!session) {
    return null;
  }

  try {
    const cookieStr = decrypt(session.cookies_encrypted);
    const cookies = JSON.parse(cookieStr);
    return { cookies, session };
  } catch (err) {
    console.error(`Failed to decrypt session for ${userId}/${platform}:`, err.message);
    return null;
  }
}

/**
 * 验证 cookie 是否仍然有效
 *
 * 通过发送一个鉴权请求到平台来检测
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} platform
 * @returns {Promise<boolean>}
 */
export async function validateSession(context, platform) {
  try {
    const page = await context.newPage();

    const checkUrls = {
      pdd: 'https://mobile.yangkeduo.com/',
      jd: 'https://order.jd.com/center/allOrders.action',
      taobao: 'https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm',
    };

    const url = checkUrls[platform] || checkUrls.pdd;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // 等待页面稳定
    await new Promise(r => setTimeout(r, 2_000));

    const currentUrl = page.url();
    await page.close();

    // 如果 URL 跳转到登录页，说明 session 已过期
    const loginIndicators = ['login', 'passport', 'signin'];
    const isLoginPage = loginIndicators.some(ind => currentUrl.includes(ind));

    return !isLoginPage;
  } catch (err) {
    console.error(`Session validation failed for ${platform}:`, err.message);
    return false;
  }
}

/**
 * 标记 session 为过期
 */
export async function markExpired(db, userId, platform) {
  await db.collection('sessions').updateOne(
    { user_openid: userId, platform },
    { $set: { status: 'expired', last_verified: new Date() } }
  );
}

/**
 * 更新验证失败计数
 */
export async function incrementFailCount(db, userId, platform) {
  await db.collection('sessions').updateOne(
    { user_openid: userId, platform },
    {
      $inc: { fail_count: 1 },
      $set: { last_verified: new Date() },
      $setOnInsert: { fail_count: 1 },
    },
    { upsert: true }
  );
}

export default { encrypt, decrypt, saveSession, loadSession, validateSession, markExpired, incrementFailCount };

/**
 * 拼多多登录模块
 *
 * 拼多多移动端扫码登录（yangkeduo.com）
 */
import { generateQR, waitForScan } from '../common/qr-login.js';
import { saveSession } from '../common/session.js';
import { getContext } from '../common/browser.js';

/**
 * 执行拼多多扫码登录
 *
 * @param {string} userId - 微信用户 openid
 * @param {object} db - 数据库对象
 * @returns {Promise<{ sessionId: string, qrBase64: string }>}
 */
export async function startLogin(userId, db) {
  const context = await getContext(userId, 'pdd');
  const page = await context.newPage();

  try {
    const { sessionId, qrBase64 } = await generateQR(context, 'pdd');
    return { sessionId, qrBase64 };
  } catch (err) {
    await page.close();
    throw err;
  }
  // 注意: page 不关闭，后续 waitForScan 需要使用
}

/**
 * 轮询扫码状态
 *
 * @param {string} sessionId - 之前返回的 sessionId
 * @param {object} db - 数据库对象
 * @param {string} userId - 微信用户 openid
 * @returns {Promise<{ status: string }>}
 */
export async function pollLoginStatus(sessionId, db, userId) {
  // 从缓存中获取登录页面
  // 注意：实际实现中需要维护 sessionId → page 的映射
  // 这里简化处理，直接通过浏览器模块获取

  const context = await getContext(userId, 'pdd');
  const pages = context.pages();
  const loginPage = pages.find(p => p.url().includes('login'));

  if (!loginPage) {
    return { status: 'unknown' };
  }

  const result = await waitForScan(loginPage, 'pdd');

  if (result.success && result.cookies) {
    // 加密保存 cookie
    await saveSession(db, userId, 'pdd', result.cookies);
    return { status: 'success', bind_at: new Date().toISOString() };
  }

  if (result.reason === 'QR code expired') {
    await loginPage.close();
    return { status: 'expired' };
  }

  if (result.reason === 'timeout') {
    await loginPage.close();
    return { status: 'expired' };
  }

  return { status: 'pending' };
}

export default { startLogin, pollLoginStatus };

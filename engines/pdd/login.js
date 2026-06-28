/**
 * 拼多多登录模块
 *
 * 拼多多扫码登录 + 短信验证码登录（yangkeduo.com）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { generateQR, waitForScan } from '../common/qr-login.js';
import { saveSession } from '../common/session.js';
import { getContext } from '../common/browser.js';

/* ───────── SMS 登录会话存储 ───────── */
/** @type {Map<string, { page: import('playwright').Page, context: import('playwright').BrowserContext, userId: string, phone: string }>} */
const smsSessions = new Map();

// SMS 会话 5 分钟过期
const SMS_SESSION_TTL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of smsSessions) {
    if (now - session.createdAt > SMS_SESSION_TTL) {
      session.page.close().catch(() => {});
      smsSessions.delete(id);
    }
  }
}, 60_000).unref();

/**
 * 生成唯一 Session ID
 */
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `qr_${ts}_${rand}`;
}

/* ───────── QR 扫码状态缓存 ───────── */
/** @type {Map<string, { status: string, success?: boolean, cookies?: import('playwright').Cookie[], reason?: string }>} */
const qrScanResults = new Map();

// QR 扫描结果 10 分钟过期清理
setInterval(() => {
  const now = Date.now();
  for (const [id, result] of qrScanResults) {
    if (result._ts && now - result._ts > 10 * 60 * 1000) {
      qrScanResults.delete(id);
    }
  }
}, 120_000).unref();

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

    // 后台监控扫码状态，结果写入缓存供 pollLoginStatus 读取
    qrScanResults.set(sessionId, { status: 'pending', _ts: Date.now() });
    waitForScan(page, 'pdd').then(result => {
      qrScanResults.set(sessionId, { ...result, status: result.success ? 'success' : (result.reason === 'QR code expired' || result.reason === 'timeout' ? 'expired' : 'pending'), _ts: Date.now() });
    }).catch(err => {
      console.error(`[PDD-QR] Background scan error for ${sessionId}:`, err.message);
      qrScanResults.set(sessionId, { status: 'unknown', _ts: Date.now() });
    });

    return { sessionId, qrBase64 };
  } catch (err) {
    await page.close();
    throw err;
  }
  // page 不关闭，后台 waitForScan 需要使用
}

/**
 * 轮询扫码状态（非阻塞，读缓存）
 *
 * @param {string} sessionId - 之前返回的 sessionId
 * @param {object} db - 数据库对象
 * @param {string} userId - 微信用户 openid
 * @returns {Promise<{ status: string }>}
 */
export async function pollLoginStatus(sessionId, db, userId) {
  const cached = qrScanResults.get(sessionId);
  if (!cached) {
    return { status: 'unknown' };
  }

  if (cached.success && cached.cookies) {
    if (db) {
      await saveSession(db, userId, 'pdd', cached.cookies);
    }
    return { status: 'success', bind_at: new Date().toISOString(), cookies: cached.cookies };
  }

  if (cached.reason === 'QR code expired' || cached.reason === 'timeout') {
    // 关闭页面（通过 context 查找）
    try {
      const context = await getContext(userId, 'pdd');
      const page = context.pages().find(p => p.url().includes('login'));
      if (page) await page.close();
    } catch {}
    return { status: 'expired' };
  }

  return { status: 'pending' };
}

/* ───────── SMS 验证码登录 ───────── */

/**
 * 第 1 步：启动 SMS 登录 - 输入手机号，请求验证码
 *
 * @param {string} userId - 微信用户 openid
 * @param {string} phone - 用户手机号
 * @returns {Promise<{ success: boolean, sessionId: string, error?: string }>}
 */
export async function startSmsLogin(userId, phone) {
  const context = await getContext(userId, 'pdd');
  const page = await context.newPage();

  try {
    await page.goto('https://yangkeduo.com/login.html', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // 桌面版默认显示手机登录，确认手机号输入框可见
    const phoneInput = page.locator('input[placeholder*="手机"], input[type="tel"]').first();
    if (!(await phoneInput.isVisible({ timeout: 5_000 }))) {
      // 如果当前在扫码界面，切回手机登录
      const phoneTab = page.locator('.phone-login, text=手机登录').first();
      if (await phoneTab.isVisible({ timeout: 2_000 })) {
        await phoneTab.click();
        await sleep(1_000);
      }
    }

    // 清空并输入手机号
    await phoneInput.clear();
    await phoneInput.fill(phone);
    await sleep(500);

    // 点击「发送验证码」按钮
    // 注意：PDD 页面布局可能将按钮渲染在视口之外，
    // 故使用 JS dispatch 模拟点击以绕过 Playwright 的视口限制
    const btnClicked = await page.evaluate(() => {
      const btn = document.querySelector('#code-button');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!btnClicked) {
      return { success: false, sessionId: null, error: 'SMS button not found via evaluate' };
    }
    await sleep(500);

    // 创建 session 并保存
    const sessionId = generateSessionId();
    smsSessions.set(sessionId, {
      page,
      context,
      userId,
      phone,
      createdAt: Date.now(),
    });

    console.log(`[PDD-SMS] Code requested for ${phone.slice(0, 3)}****${phone.slice(-4)}`);
    return { success: true, sessionId };
  } catch (err) {
    await page.close().catch(() => {});
    console.error('[PDD-SMS] Start error:', err.message);
    return { success: false, sessionId: null, error: err.message };
  }
}

/**
 * 第 2 步：验证 SMS 验证码并完成登录
 *
 * @param {string} sessionId - startSmsLogin 返回的 sessionId
 * @param {string} code - 用户收到的 6 位短信验证码
 * @param {object} db - 数据库对象
 * @returns {Promise<{ success: boolean, status?: string, error?: string }>}
 */
export async function verifySmsCode(sessionId, code, db) {
  const session = smsSessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session expired or not found' };
  }

  const { page, userId } = session;

  try {
    // 输入验证码
    const codeInput = page.locator('input[placeholder*="验证码"], input[type="tel"]').last();
    if (!(await codeInput.isVisible({ timeout: 3_000 }))) {
      return { success: false, error: 'Code input not found' };
    }
    await codeInput.clear();
    await codeInput.fill(code);
    await sleep(500);

    // 勾选同意协议（如有）
    const agreeCheckbox = page.locator('.agree-checkbox, [class*="agree"], [class*="protocol"]').first();
    if (await agreeCheckbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await agreeCheckbox.click().catch(() => {});
      await sleep(300);
    }

    // 点击「登录」按钮
    // PDD 页面布局中登录按钮也可能在视口外，使用 JS dispatch
    const loginClicked = await page.evaluate(() => {
      const btn = document.querySelector('button:has-text("登录"), .login-btn, [class*="login"]');
      // 简化版：查找包含「登录」文字的 button
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.includes('登录')) { b.click(); return true; }
      }
      return false;
    });
    if (!loginClicked) {
      return { success: false, error: 'Login button not found or not clickable' };
    }
    await sleep(500);

    // 等待登录完成（页面跳转或 cookie 写入）
    await sleep(3_000);

    // 检查是否登录成功
    const currentUrl = page.url();
    if (currentUrl.includes('login.html') || currentUrl.includes('login')) {
      // 检查是否有错误提示
      const errorMsg = await page.locator('.error-msg, [class*="error"], .toast').first().textContent().catch(() => '');
      if (errorMsg) {
        return { success: false, error: `Login failed: ${errorMsg.trim()}` };
      }
      return { success: false, error: 'Login failed - still on login page' };
    }

    // 登录成功，提取 cookies
    const cookies = await page.context().cookies();

    if (db && cookies.length > 0) {
      await saveSession(db, userId, 'pdd', cookies);
    }

    console.log(`[PDD-SMS] Login success for user ${userId}`);
    return {
      success: true,
      status: 'success',
      bind_at: new Date().toISOString(),
      cookies,
    };
  } catch (err) {
    console.error('[PDD-SMS] Verify error:', err.message);
    return { success: false, error: err.message };
  } finally {
    // 清理 session（无论成功失败）
    smsSessions.delete(sessionId);
    await page.close().catch(() => {});
  }
}

export default { startLogin, pollLoginStatus, startSmsLogin, verifySmsCode };

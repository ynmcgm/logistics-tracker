/**
 * QR 扫码登录控制器
 *
 * 职责:
 *  1. 打开平台登录页
 *  2. 等待 QR 码元素出现并截图
 *  3. 轮询等待用户扫码（检测页面跳转/特定元素）
 *  4. 超时后自动取消
 *  5. 提取登录态 cookie
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { getLoginUrl } from './stealth.js';

const QR_TIMEOUT_MS = 300_000; // 5 分钟
const POLL_INTERVAL_MS = 1_000; // 1 秒
const LOGIN_CHECK_DELAY_MS = 2_000; // 扫码后等待页面响应

/**
 * 生成 QR 码登录会话
 *
 * @param {import('playwright').BrowserContext} context
 * @param {'pdd'|'jd'|'taobao'} platform
 * @returns {Promise<{ sessionId: string, qrBase64: string }>}
 */
export async function generateQR(context, platform) {
  const page = await context.newPage();
  const loginUrl = getLoginUrl(platform);

  try {
    await page.goto(loginUrl, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // 等待二维码元素出现（各平台选择器不同）
    const qrSelector = getQRSelector(platform);
    await page.waitForSelector(qrSelector, { timeout: 15_000 });

    // 给 QR 码一点渲染时间
    await sleep(1_000);

    // 截图二维码区域
    const qrElement = await page.$(qrSelector);
    if (!qrElement) {
      throw new Error('QR code element not found');
    }

    const screenshotBuffer = await qrElement.screenshot();
    const qrBase64 = screenshotBuffer.toString('base64');
    const sessionId = generateSessionId();

    return { sessionId, qrBase64 };
  } finally {
    // 注意: 不关页面，后续 waitForScan 需要用到这个 page
    // 调用方需自行管理 page 生命周期
  }
}

/**
 * 等待用户扫码完成
 *
 * @param {import('playwright').Page} page
 * @param {'pdd'|'jd'|'taobao'} platform
 * @returns {Promise<{ success: boolean, cookies?: import('playwright').Cookie[] }>}
 */
export async function waitForScan(page, platform) {
  const startTime = Date.now();
  const checkLogin = getLoginCheckStrategy(platform);

  while (Date.now() - startTime < QR_TIMEOUT_MS) {
    try {
      // 检查是否已过期
      const isExpired = await checkExpired(page, platform);
      if (isExpired) {
        return { success: false, reason: 'QR code expired' };
      }

      // 检查是否已登录成功
      const isLoggedIn = await checkLogin(page);
      if (isLoggedIn) {
        // 等待页面稳定
        await sleep(LOGIN_CHECK_DELAY_MS);
        const cookies = await page.context().cookies();
        return { success: true, cookies };
      }
    } catch (err) {
      // 页面可能跳转导致元素检查失败，这也是登录成功的一个信号
      const currentUrl = page.url();
      if (!currentUrl.includes('login')) {
        await sleep(LOGIN_CHECK_DELAY_MS);
        const cookies = await page.context().cookies();
        return { success: true, cookies };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { success: false, reason: 'timeout' };
}

/**
 * 检查二维码是否已过期
 */
async function checkExpired(page, platform) {
  try {
    switch (platform) {
      case 'pdd':
        return await page.locator('.qr-expired, text=二维码已过期').isVisible();
      case 'jd':
        return await page.locator('.qr-expire, text=二维码已失效').isVisible();
      case 'taobao':
        return await page.locator('.qr-expired, text=已过期').isVisible();
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * 获取各平台的 QR 码选择器
 */
function getQRSelector(platform) {
  const selectors = {
    pdd: 'img[class*="qrcode"], img[src*="qrcode"]',
    jd: '.qr-code-img, img[src*="qrcode"]',
    taobao: '#J_QRCodeImg img, .qr-code img',
  };
  return selectors[platform] || 'img[src*="qrcode"]';
}

/**
 * 获取各平台的登录检测策略
 *
 * 登录成功后，各平台会有不同的表现：
 * - 拼多多：URL 跳转到首页/订单页 或 出现用户元素
 * - 京东：跳转到个人中心或出现用户名
 * - 淘宝：跳转到首页或出现用户头像
 */
function getLoginCheckStrategy(platform) {
  const strategies = {
    pdd: async (page) => {
      const url = page.url();
      // 拼多多登录成功后会跳离登录页
      if (!url.includes('login.html') && !url.includes('login')) {
        return true;
      }
      // 或者检测到用户信息元素
      return page.locator('.user-info, .user-name, [class*="avatar"]').isVisible();
    },

    jd: async (page) => {
      const url = page.url();
      if (!url.includes('passport') && !url.includes('login')) {
        return true;
      }
      return page.locator('.nickname, .user-name').isVisible();
    },

    taobao: async (page) => {
      const url = page.url();
      if (!url.includes('login.taobao.com')) {
        return true;
      }
      return page.locator('.member-nick, .user-name').isVisible();
    },
  };

  return strategies[platform] || strategies.pdd;
}

/**
 * 生成唯一 Session ID
 */
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `qr_${ts}_${rand}`;
}

export default { generateQR, waitForScan };

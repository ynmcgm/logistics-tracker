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

/* ───────── PDD 专用：解密 anti_content ───────── */
/**
 * PDD 的 query_qr_code 响应中携带 secret_key + data URL。
 * 页面 JS 用该 secret_key + anti_content 轮询 check_qr_code 检测扫码状态。
 * 我们存储 secret_key 并在 waitForScan 中复用页面的 XHR 拦截来判定结果。
 */

/**
 * PDD 桌面登录页面默认显示「手机登录」，需要先切换至「扫码登录」标签。
 */
async function switchToPddQrTab(page) {
  const tabSelectors = [
    '.qrcode-login',
    'text=扫码登录',
  ];
  for (const sel of tabSelectors) {
    try {
      const tab = page.locator(sel).first();
      if (await tab.isVisible({ timeout: 1_000 })) {
        await tab.click({ timeout: 3_000 });
        console.log(`[QR] PDD: switched to QR tab via "${sel}"`);
        return;
      }
    } catch {
      // 选择器未命中，尝试下一个
    }
  }
  // 如果已经显示 QR 码（如部分移动版直接显示），跳过
  console.log('[QR] PDD: QR tab not found, assuming QR already visible');
}

/**
 * 在 PDD 桌面页上拦截 query_qr_code API 响应以获取 secret_key。
 */
async function interceptQrSecret(page) {
  let secretKey = null;
  const handler = async (response) => {
    const url = response.url();
    if (url.includes('/api/cupid/query_qr_code')) {
      try {
        const body = await response.json();
        if (body && body.secret_key) {
          secretKey = body.secret_key;
          console.log(`[QR] PDD: captured secret_key: ${secretKey.slice(0, 12)}...`);
        }
      } catch {
        // 忽略解析失败
      }
    }
  };
  page.on('response', handler);
  // 返回取消监听的函数
  return () => page.off('response', handler);
}

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

    // PDD 桌面版默认显示手机登录，需先切换到扫码登录标签
    if (platform === 'pdd') {
      await switchToPddQrTab(page);
      // 等待 QR 码渲染 + API 响应
      await sleep(2_000);
    }

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

  // PDD: 拦截 check_qr_code API 响应以快速检测扫码成功
  let scanSuccess = false;
  let unlisten = null;
  if (platform === 'pdd') {
    unlisten = await interceptQrCheck(page, (body) => {
      // check_qr_code 返回 success: true 表示扫码并确认
      if (body && body.success === true) {
        scanSuccess = true;
      }
    });
  }

  try {
    while (Date.now() - startTime < QR_TIMEOUT_MS) {
      try {
        // 检查是否已过期
        const isExpired = await checkExpired(page, platform);
        if (isExpired) {
          return { success: false, reason: 'QR code expired' };
        }

        // PDD API 拦截检测（最快速）
        if (scanSuccess) {
          await sleep(1000);
          // 导航到首页触发 PDD 写入鉴权 cookie（set-cookie 在导航响应头中）
          if (platform === 'pdd') {
            try {
              await page.goto('https://yangkeduo.com/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            } catch { /* 导航失败无所谓，当前 cookie 可能已包含鉴权信息 */ }
          }
          return await extractCookies(page);
        }

        // 常规页面检测（URL 跳转 / 用户元素）
        const isLoggedIn = await checkLogin(page);
        if (isLoggedIn) {
          await sleep(LOGIN_CHECK_DELAY_MS);
          return await extractCookies(page);
        }
      } catch (err) {
        // 页面跳转导致元素检查失败，但可能是反爬重定向而非真实登录
        // 需要和有 auth cookie 才确认
        try {
          const url = page.url();
          if (!url.includes('login') && await hasAuthCookies(page)) {
            await sleep(LOGIN_CHECK_DELAY_MS);
            return await extractCookies(page);
          }
        } catch {
          // 完全无法操作页面，视作失效
          return { success: false, reason: 'page unavailable' };
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return { success: false, reason: 'timeout' };
  } finally {
    if (unlisten) unlisten();
  }
}

/**
 * 提取页面 cookie 并返回
 */
async function extractCookies(page) {
  const cookies = await page.context().cookies();
  return { success: true, cookies };
}

/**
 * 检查页面是否有 PDD 鉴权 cookie（避免 URL 重定向导致的误判）
 */
async function hasAuthCookies(page) {
  try {
    const cookies = await page.context().cookies();
    return cookies.some(c =>
      c.name.includes('pdd_token') ||
      c.name.includes('_pdd_') ||
      c.name.includes('PDDAccessToken')
    );
  } catch {
    return false;
  }
}

/**
 * PDD: 拦截 check_qr_code API 响应
 * @param {import('playwright').Page} page
 * @param {(body: object) => void} onBody - 每次 API 响应时回调
 * @returns {() => void} 取消监听的函数
 */
async function interceptQrCheck(page, onBody) {
  const handler = async (response) => {
    const url = response.url();
    if (url.includes('/api/cupid/login/check_qr_code')) {
      try {
        const body = await response.json();
        onBody(body);
      } catch {
        // 忽略解析失败
      }
    }
  };
  page.on('response', handler);
  return () => page.off('response', handler);
}

/**
 * 检查二维码是否已过期
 */
async function checkExpired(page, platform) {
  try {
    switch (platform) {
      case 'pdd':
        // PDD 桌面版过期时可能显示过期文案或 QR 码被隐藏
        return await page.locator('.qr-expired, text=二维码已过期').isVisible()
          || !(await page.locator('img.qr-code-box').first().isVisible().catch(() => false));
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
    pdd: 'img.qr-code-box',
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
      // 拼多多登录成功后会跳离登录页（到首页或订单页）
      if (!url.includes('login.html') && !url.includes('login')) {
        // URL 变化不代表登录成功——PDD 可能因反爬/空闲重定向到首页。
        // 必须有鉴权 cookie 才确认登录。
        try {
          const cookies = await page.context().cookies();
          const pddCookie = cookies.find(c =>
            c.name.includes('pdd_token') ||
            c.name.includes('_pdd_') ||
            c.name.includes('PDDAccessToken')
          );
          if (pddCookie) return true;
        } catch {}
        return false;
      }
      // 桌面版登录成功后可见用户头像/昵称
      const userVisible = await page.locator('.user-info, .user-name, [class*="avatar"]')
        .first().isVisible().catch(() => false);
      if (userVisible) return true;
      // 某些情况下 cookie 已写入但页面未及时跳转
      try {
        const cookies = await page.context().cookies();
        const pddCookie = cookies.find(c =>
          c.name.includes('pdd_token') ||
          c.name.includes('_pdd_') ||
          c.name.includes('PDDAccessToken')
        );
        if (pddCookie) return true;
      } catch {
        // ignore
      }
      return false;
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

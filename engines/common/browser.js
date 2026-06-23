/**
 * 浏览器池管理模块
 *
 * 单例模式，全局只维护一个 Chromium 实例。
 * 所有引擎共享同一个浏览器，但每个用户使用隔离的 BrowserContext。
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getStealthConfig } from './stealth.js';

// 应用反检测插件
chromium.use(StealthPlugin());

let _browser = null;
let _contexts = new Map();

/**
 * 获取或创建浏览器实例
 */
export async function getBrowser() {
  if (_browser && _browser.isConnected()) {
    return _browser;
  }

  const config = getStealthConfig();
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      ...config.args,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  _browser.on('disconnected', () => {
    _browser = null;
    _contexts.clear();
  });

  return _browser;
}

/**
 * 为指定用户获取隔离的 BrowserContext
 * 如果用户已有 context 且未关闭，直接返回
 */
export async function getContext(userId, platform = 'default') {
  const key = `${userId}:${platform}`;

  if (_contexts.has(key)) {
    const ctx = _contexts.get(key);
    try {
      // 通过创建临时页面检测 context 是否有效
      const page = await ctx.newPage();
      await page.close();
      return ctx;
    } catch {
      _contexts.delete(key);
    }
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/125.0.0.0 Safari/537.36',
  });

  _contexts.set(key, context);
  return context;
}

/**
 * 从 Cookie JSON 字符串恢复 BrowserContext
 */
export async function restoreContext(userId, platform, cookieJson) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1920, height: 1080 },
  });

  const cookies = JSON.parse(cookieJson);
  await context.addCookies(cookies);

  const key = `${userId}:${platform}`;

  // 关闭旧的 context（如果有）
  if (_contexts.has(key)) {
    try {
      await _contexts.get(key).close();
    } catch { /* ignore */ }
  }

  _contexts.set(key, context);
  return context;
}

/**
 * 关闭所有浏览器上下文
 */
export async function closeAll() {
  for (const [, ctx] of _contexts) {
    try { await ctx.close(); } catch { /* ignore */ }
  }
  _contexts.clear();

  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
  }
}

/**
 * 获取当前活跃的 context 数量
 */
export function getActiveContextCount() {
  return _contexts.size;
}

export default { getBrowser, getContext, restoreContext, closeAll };

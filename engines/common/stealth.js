/**
 * 反检测配置模块
 *
 * 为 Playwright 浏览器配置 stealth 参数，
 * 减少被电商平台检测为自动化工具的风险。
 */

/**
 * 获取浏览器反检测配置
 * @param {'pdd'|'jd'|'taobao'|'default'} platform
 */
export function getStealthConfig(platform = 'default') {
  const common = {
    // 禁用自动化标志
    disableAutomation: true,
    // 模拟 Chrome 运行时
    mockChromeRuntime: true,
    // 模拟权限
    mockPermissions: true,
    // 模拟 WebGL 厂商
    mockWebGL: true,
    // 模拟硬件并发数
    mockHardwareConcurrency: 4,
    // 模拟设备内存
    mockDeviceMemory: 8,
    // 覆盖 navigator.plugins
    mockPlugins: true,
    // 覆盖 navigator.languages
    locales: ['zh-CN', 'zh', 'en'],
  };

  const platformSpecific = {
    pdd: {
      // 拼多多桌面版登录页 — desktop UA 可减少 SPA 跳转，且 QR 码渲染更稳定
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
    },
    jd: {
      // 京东桌面版
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
    },
    taobao: {
      // 淘宝反爬最严，需要更多伪装
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
      // 淘宝的特殊处理
      disableWebDriver: true,
      mockChromeApp: true,
    },
    default: {
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/125.0.0.0 Safari/537.36',
    },
  };

  return {
    ...common,
    ...platformSpecific[platform] || platformSpecific.default,
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
  };
}

/**
 * 获取平台登录 URL
 * @param {'pdd'|'jd'|'taobao'} platform
 */
export function getLoginUrl(platform) {
  const urls = {
    pdd: 'https://yangkeduo.com/login.html',
    jd: 'https://passport.jd.com/new/login.aspx',
    taobao: 'https://login.taobao.com/',
  };
  return urls[platform] || urls.pdd;
}

/**
 * 获取平台订单页 URL
 * @param {'pdd'|'jd'|'taobao'} platform
 */
export function getOrdersUrl(platform) {
  const urls = {
    pdd: 'https://mobile.yangkeduo.com/my_order.html',
    jd: 'https://order.jd.com/center/allOrders.action',
    taobao: 'https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm',
  };
  return urls[platform] || urls.pdd;
}

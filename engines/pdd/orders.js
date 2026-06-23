/**
 * 拼多多订单抓取模块
 *
 * 从拼多多「我的订单」页面抓取订单数据。
 * 重点关注「待收货」和「已发货」状态的订单。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { getOrdersUrl } from '../common/stealth.js';
import { detectStatus, extractCity } from '../common/status-detector.js';
import { detectCourier, normalizeCourierName } from '../common/courier-db.js';

const ORDER_SCROLL_WAIT = 1500;    // 滚动加载等待时间
const MAX_SCROLLS = 30;            // 最大滚动次数（防无限滚动）
const MAX_ORDER_PAGES = 5;         // 最多翻页数

/**
 * 抓取拼多多所有进行中的订单
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ orderId, productName, status, trackingNumber, courier, courierCode }>>}
 */
export async function scrapeOrders(page) {
  const ordersUrl = getOrdersUrl('pdd');
  await page.goto(ordersUrl, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  // 等待订单列表加载
  await page.waitForSelector('[class*="order"], [class*="order-list"]', {
    timeout: 15_000,
  }).catch(() => {
    // 可能页面结构不同，继续尝试
  });

  // 滚动加载所有订单
  await scrollLoadAll(page);

  // 提取订单列表
  const orders = await page.evaluate(() => {
    const items = [];
    // 尝试多种可能的选择器
    const orderElements = document.querySelectorAll(
      '[class*="order-item"], [class*="order-card"], [class*="goods-item"]'
    );

    orderElements.forEach(el => {
      const text = el.textContent.trim();

      // 只处理待收货 / 已完成 / 已发货
      if (!text.includes('待收货') && !text.includes('已完成') &&
          !text.includes('待发货') && !text.includes('已发货')) {
        return;
      }

      items.push({
        rawText: text,
        html: el.innerHTML.substring(0, 2000), // 保留部分 HTML 供后续解析
      });
    });

    return items;
  });

  console.log(`[PDD] Found ${orders.length} order elements on page`);

  // 解析每个订单
  const parsedOrders = [];
  for (const order of orders) {
    const parsed = parseOrderElement(order);
    if (parsed) {
      parsedOrders.push(parsed);
    }
  }

  // 尝试提取运单号（需要点击查看物流）
  for (const order of parsedOrders) {
    if (order.status === '已发货' || order.status === '待收货') {
      const tracking = await extractTrackingFromOrder(page, order);
      if (tracking) {
        order.trackingNumber = tracking.number;
        order.courier = tracking.courier;
        order.courierCode = tracking.courierCode;
      }
    }
  }

  return parsedOrders;
}

/**
 * 滚动加载直到所有订单加载完成
 */
async function scrollLoadAll(page) {
  for (let i = 0; i < MAX_SCROLLS; i++) {
    const previousHeight = await page.evaluate('document.body.scrollHeight');

    // 模拟用户滚动
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await sleep(ORDER_SCROLL_WAIT);

    const newHeight = await page.evaluate('document.body.scrollHeight');
    if (newHeight === previousHeight) {
      // 没有新内容加载
      break;
    }
  }
}

/**
 * 解析单个订单元素
 *
 * @param {{ rawText: string, html: string }} orderElement
 * @returns {{ orderId: string|null, productName: string, status: string }}
 */
function parseOrderElement(orderElement) {
  const text = orderElement.rawText;

  // 提取商品名称（通常在订单中的第一行商品描述）
  const productMatch = text.match(/([\u4e00-\u9fa5\w\s]{2,50})(?=\s*(?:订单|编号|￥|¥|状态|待|已))/) ||
                       text.match(/商品[：:\s]*([^\n]{2,50})/);

  const productName = productMatch?.[1]?.trim() || '未知商品';

  // 提取订单状态
  const statusMatch = text.match(/(待收货|待发货|已发货|已完成|已取消|待评价)/);
  const status = statusMatch?.[1] || '未知';

  // 提取订单编号
  const orderIdMatch = text.match(/(?:订单[号编]|[一-龟]?[Oo]rder[Ii][Dd])[：:\s]*(\d{15,25})/);
  const orderId = orderIdMatch?.[1] || null;

  return {
    orderId,
    productName,
    status,
    trackingNumber: null,
    courier: null,
    courierCode: null,
  };
}

/**
 * 点击"查看物流"提取运单号
 *
 * @param {import('playwright').Page} page
 * @param {object} order
 * @returns {Promise<{ number: string, courier: string, courierCode: string } | null>}
 */
async function extractTrackingFromOrder(page, order) {
  try {
    // 尝试找到对应订单的"查看物流"按钮
    // 拼多多移动版的物流信息可能在弹窗或新页面中

    // 方式1: 在订单卡片中找物流信息
    const trackingInCard = await page.evaluate(() => {
      const text = document.body.innerText;
      const trackingMatch = text.match(/(?:运单号|快递单号|物流编号)[：:\s]*([A-Za-z0-9]{10,20})/);
      const courierMatch = text.match(/(中通快递|圆通速递|韵达快递|申通快递|顺丰速运|极兔速递|邮政快递|京东快递|百世快递|德邦快递)/);

      if (trackingMatch) {
        return {
          number: trackingMatch[1],
          courier: courierMatch?.[1] || null,
        };
      }
      return null;
    });

    if (trackingInCard) {
      const courierInfo = trackingInCard.courier
        ? { name: normalizeCourierName(trackingInCard.courier), code: null }
        : detectCourier(trackingInCard.number);

      const courierName = courierInfo?.name || trackingInCard.courier || '未知快递';
      const courierCode = courierInfo?.code || '';

      return {
        number: trackingInCard.number,
        courier: courierName,
        courierCode: courierCode,
      };
    }

    // 方式2: 点击"查看物流"（拼多多通常在弹窗中显示）
    const logisticsBtn = page.locator('text=查看物流').first();
    if (await logisticsBtn.isVisible()) {
      await logisticsBtn.click();
      await sleep(3_000); // 等待弹窗

      // 从弹窗中提取
      const popupTracking = await page.evaluate(() => {
        const text = document.body.innerText;
        const trackingMatch = text.match(/(?:运单号|快递单号|物流编号)[：:\s]*([A-Za-z0-9]{10,20})/);
        const courierMatch = text.match(
          /(中通快递|圆通速递|韵达快递|申通快递|顺丰速运|极兔速递|邮政快递|京东快递|百世快递|德邦快递)/
        );
        return trackingMatch ? {
          number: trackingMatch[1],
          courier: courierMatch?.[1] || null,
        } : null;
      });

      // 关闭弹窗
      const closeBtn = page.locator('[class*="close"], [class*="mask"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await sleep(500);
      }

      if (popupTracking) {
        const courierInfo = popupTracking.courier
          ? { name: normalizeCourierName(popupTracking.courier), code: null }
          : detectCourier(popupTracking.number);
        return {
          number: popupTracking.number,
          courier: courierInfo?.name || popupTracking.courier || '未知快递',
          courierCode: courierInfo?.code || '',
        };
      }
    }

    return null;
  } catch (err) {
    console.error(`[PDD] Failed to extract tracking for order:`, err.message);
    return null;
  }
}

export default { scrapeOrders };

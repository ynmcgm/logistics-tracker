/**
 * 拼多多页面解析器
 *
 * 从原始文本/HTML 中提取结构化数据。
 */

/**
 * 从文本中提取拼多多订单号
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parsePddOrderId(text) {
  if (!text) return null;
  // 拼多多订单号：18-20 位纯数字
  const match = text.match(/\b(\d{18,20})\b/);
  return match?.[1] || null;
}

/**
 * 从文本中提取运单号
 *
 * 支持格式:
 *   - 纯数字: 12-15 位
 *   - SF开头: SF + 10-12 位数字
 *   - JD开头: JD + 10-15 位数字/字母
 *   - YT开头: YT + 10-15 位数字
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseTrackingNumber(text) {
  if (!text) return null;

  // 按优先级尝试不同模式
  const patterns = [
    // 前面有明确标识
    /(?:运单号|快递单号|物流单号|运单编号)[：:\s]*([A-Za-z0-9]{10,25})/,
    /(?:跟踪号|追踪号)[：:\s]*([A-Za-z0-9]{10,25})/,
    // 顺丰格式
    /\b(SF\d{10,15})\b/i,
    // 京东格式
    /\b(JD[A-Za-z0-9]{10,15})\b/i,
    // 圆通格式
    /\b(YT\d{10,15})\b/i,
    // EMS 格式
    /\b(EMS[A-Za-z0-9]{9,15})\b/i,
    // 纯数字运单号
    /\b(\d{12,15})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * 脱敏运单号（显示前4位和后4位，中间用*号）
 *
 * @param {string} trackingNumber
 * @returns {string}
 */
export function maskTrackingNumber(trackingNumber) {
  if (!trackingNumber) return '';
  const tn = trackingNumber.trim();
  if (tn.length <= 8) {
    return tn.substring(0, 4) + '****';
  }
  return tn.substring(0, 4) + '****' + tn.substring(tn.length - 4);
}

/**
 * 从拼多多订单页提取用户信息（用户名、地址等）
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object|null>}
 */
export async function extractUserInfo(page) {
  try {
    return await page.evaluate(() => {
      const text = document.body.innerText;
      const nameMatch = text.match(/(?:用户|昵称|Hi)[，:：\s]*(\S{1,20})/);
      return {
        nickname: nameMatch?.[1] || null,
      };
    });
  } catch {
    return null;
  }
}

export default { parsePddOrderId, parseTrackingNumber, maskTrackingNumber, extractUserInfo };

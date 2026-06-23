/**
 * 快递公司数据库
 *
 * 根据运单号前缀检测快递公司，并提供快递100 API 所需的公司编码。
 */

const COURIERS = [
  /**
   * 按检测优先级排序
   * 前缀匹配优先于长度匹配
   */
  // ===== 前缀匹配 =====
  { prefix: /^SF/i,            name: '顺丰速运',     code: 'shunfeng' },
  { prefix: /^JD/i,            name: '京东快递',     code: 'jd' },
  { prefix: /^YT/i,            name: '圆通速递',     code: 'yuantong' },
  { prefix: /^EMS/i,           name: 'EMS',         code: 'ems' },
  { prefix: /^STO/i,           name: '申通快递',     code: 'shentong' },
  { prefix: /^FAST/i,          name: '快捷快递',     code: 'kuaijie' },
  { prefix: /^UC/i,            name: '优速快递',     code: 'yousu' },
  { prefix: /^DBL/i,           name: '德邦快递',     code: 'debang' },
  { prefix: /^JT/i,            name: '极兔速递',     code: 'jitu' },
  { prefix: /^BLACK/i,         name: '黑猫宅急便',   code: 'zhaimen' },
  { prefix: /^TT/i,            name: '天天快递',     code: 'tiantian' },
  { prefix: /^SURE/i,          name: '速尔快递',     code: 'sure' },
  { prefix: /^ZJS/i,           name: '宅急送',       code: 'zhaijisong' },
  { prefix: /^YZ/i,            name: '邮政快递',     code: 'youzhengguonei' },
  { prefix: /^BEST/i,          name: '百世快递',     code: 'baishiwuliu' },

  // ===== 数字长度匹配（兜底） =====
  // 各快递公司运单号常见的数字位数
  { prefix: /^\d{12}$/,        name: '中通快递',     code: 'zhongtong' },
  { prefix: /^\d{13}$/,        name: '中通快递',     code: 'zhongtong' },
  { prefix: /^\d{14}$/,        name: '韵达快递',     code: 'yunda' },
  { prefix: /^\d{15}$/,        name: '圆通速递',     code: 'yuantong' },
  { prefix: /^\d{10}$/,        name: '申通快递',     code: 'shentong' },
  { prefix: /^\d{18}$/,        name: '邮政快递',     code: 'youzhengguonei' },
];

// 常见快递公司别名映射（用于用户显示）
const COURIER_ALIASES = {
  '中通': '中通快递',
  '圆通': '圆通速递',
  '韵达': '韵达快递',
  '申通': '申通快递',
  '顺丰': '顺丰速运',
  '京东': '京东快递',
  '极兔': '极兔速递',
  '百世': '百世快递',
  '德邦': '德邦快递',
  '天天': '天天快递',
  '邮政': '邮政快递',
};

/**
 * 根据运单号检测快递公司
 *
 * @param {string} trackingNumber
 * @returns {{ name: string, code: string } | null}
 */
export function detectCourier(trackingNumber) {
  if (!trackingNumber || typeof trackingNumber !== 'string') {
    return null;
  }

  for (const courier of COURIERS) {
    if (courier.prefix.test(trackingNumber.trim())) {
      return { name: courier.name, code: courier.code };
    }
  }

  return null;
}

/**
 * 规范化快递公司名称
 *
 * @param {string} rawName - 从页面提取的原始名称
 * @returns {string} 标准化名称
 */
export function normalizeCourierName(rawName) {
  if (!rawName) return '未知快递';

  const trimmed = rawName.trim();

  // 直接匹配别名
  if (COURIER_ALIASES[trimmed]) {
    return COURIER_ALIASES[trimmed];
  }

  // 包含匹配
  for (const [alias, name] of Object.entries(COURIER_ALIASES)) {
    if (trimmed.includes(alias)) {
      return name;
    }
  }

  return trimmed;
}

/**
 * 获取所有支持的快递公司列表（用于前端展示）
 */
export function getSupportedCouriers() {
  const seen = new Set();
  const couriers = [];
  for (const c of COURIERS) {
    if (!seen.has(c.code)) {
      seen.add(c.code);
      couriers.push({ name: c.name, code: c.code });
    }
  }
  return couriers;
}

export default { detectCourier, normalizeCourierName, getSupportedCouriers };

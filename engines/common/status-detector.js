/**
 * 物流状态检测引擎
 *
 * 根据物流描述文本，自动分类到标准状态类别。
 * 只对「关键节点」触发通知。
 */

/**
 * 状态分类枚举
 */
export const StatusCategory = {
  COLLECTED: 'collected',          // 已揽收
  IN_TRANSIT: 'in_transit',        // 运输中
  ARRIVED_CITY: 'arrived_city',    // 到达目的地城市 ★ 关键节点
  DELIVERING: 'delivering',        // 派送中
  SIGNED: 'signed',                // 已签收 ★ 关键节点
  ABNORMAL: 'abnormal',            // 异常/滞留 ★ 关键节点
  OTHER: 'other',                  // 其他
};

/**
 * 判断是否为关键节点（需推送通知）
 */
export function isKeyEvent(category) {
  return (
    category === StatusCategory.ARRIVED_CITY ||
    category === StatusCategory.SIGNED ||
    category === StatusCategory.ABNORMAL
  );
}

/**
 * 状态检测规则
 *
 * 每条规则：{ patterns: RegExp[], category: StatusCategory }
 * 按优先级排列，命中即返回
 */
const RULES = [
  // ===== 已签收（优先检测） =====
  {
    patterns: [
      /已签收/, /本人签收/, /家人签收/, /代收/,
      /已投递/, /已放入(快递柜|丰巢|菜鸟)/,
      /已被(?:\S+)签收/,
      /签收人/,
    ],
    category: StatusCategory.SIGNED,
  },

  // ===== 派送中 =====
  {
    patterns: [
      /派送/, /配送中/, /快递员/, /正在派件/,
      /已分配.*投递/, /即将配送/,
    ],
    category: StatusCategory.DELIVERING,
  },

  // ===== 到达目的地城市 =====
  {
    patterns: [
      /到达.*(?:目的地|目的城市|所在城市|收件)/,
      /已到达.*(?:分拨|中转|配送)中心(?!.*发出)/,
      /到达.*市(?!.*发出)/,
      /(?:到|达)(?:上海|北京|天津|重庆|广州|深圳|杭州|成都|武汉|西安|南京|苏州|郑州|长沙|东莞|青岛|沈阳|宁波|昆明|大连|厦门|合肥|佛山|福州|哈尔滨|济南|温州|长春|石家庄|常州|泉州|南宁|贵阳|南昌|太原|烟台|嘉兴|南通|金华|珠海|惠州|徐州|海口|乌鲁木齐|绍兴|中山|台州|兰州)/u,
    ],
    category: StatusCategory.ARRIVED_CITY,
  },

  // ===== 异常 =====
  {
    patterns: [
      /退回/, /拒收/, /无人/,
      /异常/, /延误/, /滞留/,
      /电话不通/, /地址不详/, /无法联系/,
      /客户要求/, /改址/,
      /(?:超过|超出).*(?:期限|时效)/,
      /配送失败/, /派送失败/,
    ],
    category: StatusCategory.ABNORMAL,
  },

  // ===== 已揽收 =====
  {
    patterns: [
      /已揽收/, /揽收/, /已收件/,
      /已(?:由|被).*揽收/,
      /快递.*已收/,
    ],
    category: StatusCategory.COLLECTED,
  },

  // ===== 运输中 =====
  {
    patterns: [
      /已(?:从|由).*(?:发出|发货|发往)/,
      /运输/, /发往/, /送往/,
      /到达.*(?:中转|分拨)(?=.*(?!中心))/,  // 非中心的中转站
      /离开.*(?:分拨|中转|集散)/,
      /正在.*(?:运|送)/,
      /已.*中转/,
    ],
    category: StatusCategory.IN_TRANSIT,
  },
];

/**
 * 检测物流文本的状态分类
 *
 * @param {string} context - 物流描述文本
 * @returns {{ category: string, matchedPattern: string, isKey: boolean }}
 */
export function detectStatus(context) {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = context.match(pattern);
      if (match) {
        return {
          category: rule.category,
          matchedPattern: match[0],
          isKey: isKeyEvent(rule.category),
        };
      }
    }
  }

  return {
    category: StatusCategory.OTHER,
    matchedPattern: null,
    isKey: false,
  };
}

/**
 * 从物流文本中提取城市名
 *
 * @param {string} context
 * @returns {string|null}
 */
export function extractCity(context) {
  // 匹配 "到达XX城市" 或 "XX市" 或 "到达上海分拨中心"
  const cityPattern = /(?:到达|在|抵达)([\u4e00-\u9fa5]{2,4}(?:市|区|县))|(?:到达|在|抵达)([\u4e00-\u9fa5]{2,3})(?:(?:分拨|中转|集散|配送|转运))/;
  const match = context.match(cityPattern);
  if (match) {
    return match[1] || match[2] || null;
  }

  // 兜底: 匹配独立的城市名
  const cities = /([\u4e00-\u9fa5]{2,3}(?:市|区|县))/;
  const fallback = context.match(cities);
  if (fallback) {
    return fallback[1];
  }

  return null;
}

import crypto from 'node:crypto';

/**
 * 生成轨迹内容的 hash，用于去重
 *
 * @param {string} context - 物流描述
 * @param {string} time - 时间字符串
 * @returns {string}
 */
export function hashContext(context, time) {
  return crypto.createHash('md5').update(`${context}|${time}`).digest('hex');
}

export default { detectStatus, extractCity, hashContext, isKeyEvent, StatusCategory };

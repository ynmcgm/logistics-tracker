/**
 * 单元测试：解析器
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 从引擎代码中导入（路径相对于引擎根目录）
// 在测试运行时，通过 --import 或 package.json 配置好路径解析
import {
  parsePddOrderId,
  parseTrackingNumber,
  maskTrackingNumber,
} from '../../engines/pdd/parser.js';

import {
  detectCourier,
  normalizeCourierName,
} from '../../engines/common/courier-db.js';

import {
  detectStatus,
  extractCity,
  hashContext,
  isKeyEvent,
  StatusCategory,
} from '../../engines/common/status-detector.js';

// =====================================================
// 拼多多订单号解析
// =====================================================
describe('parsePddOrderId', () => {
  it('should extract 18-digit order ID', () => {
    assert.equal(parsePddOrderId('订单编号：123456789012345678'), '123456789012345678');
  });

  it('should extract 20-digit order ID', () => {
    assert.equal(parsePddOrderId('OrderID: 12345678901234567890'), '12345678901234567890');
  });

  it('should return null for empty input', () => {
    assert.equal(parsePddOrderId(''), null);
    assert.equal(parsePddOrderId(null), null);
    assert.equal(parsePddOrderId(undefined), null);
  });

  it('should return null when no order ID found', () => {
    assert.equal(parsePddOrderId('这是一段没有编号的文本'), null);
  });

  it('should not match short number sequences', () => {
    assert.equal(parsePddOrderId('编号：12345'), null);
  });
});

// =====================================================
// 运单号解析
// =====================================================
describe('parseTrackingNumber', () => {
  it('should extract with "运单号" prefix', () => {
    assert.equal(
      parseTrackingNumber('运单号：773012345678'),
      '773012345678'
    );
  });

  it('should extract with "快递单号" prefix', () => {
    assert.equal(
      parseTrackingNumber('快递单号：SF1234567890'),
      'SF1234567890'
    );
  });

  it('should extract SF tracking number', () => {
    assert.equal(parseTrackingNumber('SF1234567890'), 'SF1234567890');
  });

  it('should extract JD tracking number', () => {
    assert.equal(parseTrackingNumber('JD1234567890ABC'), 'JD1234567890ABC');
  });

  it('should extract YT tracking number', () => {
    assert.equal(parseTrackingNumber('YT123456789012'), 'YT123456789012');
  });

  it('should extract plain numeric tracking number', () => {
    assert.equal(parseTrackingNumber('773012345678'), '773012345678');
  });

  it('should extract 13-digit tracking number', () => {
    assert.equal(parseTrackingNumber('7730123456789'), '7730123456789');
  });

  it('should return null for text without tracking number', () => {
    assert.equal(parseTrackingNumber('没有运单信息'), null);
  });

  it('should return null for empty input', () => {
    assert.equal(parseTrackingNumber(''), null);
  });

  it('should not match short numbers (less than 10 digits)', () => {
    assert.equal(parseTrackingNumber('电话：13800138000'), null);
  });
});

// =====================================================
// 运单号脱敏
// =====================================================
describe('maskTrackingNumber', () => {
  it('should mask middle digits with asterisks', () => {
    assert.equal(maskTrackingNumber('773012345678'), '7730****5678');
  });

  it('should handle short numbers', () => {
    assert.equal(maskTrackingNumber('SF123456'), 'SF12****');
  });

  it('should handle empty input', () => {
    assert.equal(maskTrackingNumber(''), '');
    assert.equal(maskTrackingNumber(null), '');
  });
});

// =====================================================
// 快递公司检测
// =====================================================
describe('detectCourier', () => {
  it('should detect 顺丰 from SF prefix', () => {
    const result = detectCourier('SF1234567890');
    assert.equal(result.name, '顺丰速运');
    assert.equal(result.code, 'shunfeng');
  });

  it('should detect 京东 from JD prefix', () => {
    const result = detectCourier('JD1234567890');
    assert.equal(result.name, '京东快递');
    assert.equal(result.code, 'jd');
  });

  it('should detect 中通 from 12-digit number', () => {
    const result = detectCourier('773012345678');
    assert.equal(result.name, '中通快递');
    assert.equal(result.code, 'zhongtong');
  });

  it('should return null for unknown format', () => {
    assert.equal(detectCourier('XX1234'), null);
  });

  it('should return null for empty input', () => {
    assert.equal(detectCourier(''), null);
  });
});

// =====================================================
// 快递公司名称规范化
// =====================================================
describe('normalizeCourierName', () => {
  it('should normalize 中通 to 中通快递', () => {
    assert.equal(normalizeCourierName('中通'), '中通快递');
  });

  it('should normalize 顺丰 to 顺丰速运', () => {
    assert.equal(normalizeCourierName('顺丰'), '顺丰速运');
  });

  it('should keep already normalized names', () => {
    assert.equal(normalizeCourierName('中通快递'), '中通快递');
  });

  it('should handle partial match in longer text', () => {
    assert.equal(
      normalizeCourierName('中通快递-上海分拨中心'),
      '中通快递'
    );
  });

  it('should return original for unknown names', () => {
    assert.equal(normalizeCourierName('火星快递'), '火星快递');
  });

  it('should return 未知快递 for empty input', () => {
    assert.equal(normalizeCourierName(''), '未知快递');
  });
});

// =====================================================
// 物流状态检测
// =====================================================
describe('detectStatus', () => {
  it('should detect signed status', () => {
    const result = detectStatus('快件已被本人签收');
    assert.equal(result.category, StatusCategory.SIGNED);
    assert.equal(result.isKey, true);
  });

  it('should detect arrived city status', () => {
    const result = detectStatus('快件已到达上海分拨中心');
    assert.equal(result.category, StatusCategory.ARRIVED_CITY);
    assert.equal(result.isKey, true);
  });

  it('should detect in_transit status', () => {
    const result = detectStatus('快件已从杭州发往上海');
    assert.equal(result.category, StatusCategory.IN_TRANSIT);
    assert.equal(result.isKey, false);
  });

  it('should detect collected status', () => {
    const result = detectStatus('快件已被揽收');
    assert.equal(result.category, StatusCategory.COLLECTED);
    assert.equal(result.isKey, false);
  });

  it('should detect delivering status', () => {
    const result = detectStatus('快递员正在派送中');
    assert.equal(result.category, StatusCategory.DELIVERING);
    assert.equal(result.isKey, false);
  });

  it('should detect abnormal status (returned)', () => {
    const result = detectStatus('因地址不详，快件退回发件人');
    assert.equal(result.category, StatusCategory.ABNORMAL);
    assert.equal(result.isKey, true);
  });

  it('should detect abnormal status (delayed)', () => {
    const result = detectStatus('快件长时间未更新，可能已滞留');
    assert.equal(result.category, StatusCategory.ABNORMAL);
    assert.equal(result.isKey, true);
  });

  it('should return other for unknown status', () => {
    const result = detectStatus('快件正在等待清关');
    assert.equal(result.category, StatusCategory.OTHER);
    assert.equal(result.isKey, false);
  });
});

// =====================================================
// 城市提取
// =====================================================
describe('extractCity', () => {
  it('should extract city from "到达上海市"', () => {
    assert.equal(extractCity('快件已到达上海市'), '上海市');
  });

  it('should extract city from "到达上海分拨中心"', () => {
    assert.equal(extractCity('快件已到达上海分拨中心'), '上海');
  });

  it('should return null for text without city', () => {
    assert.equal(extractCity('快件正在运输中'), null);
  });
});

// =====================================================
// 轨迹去重 hash
// =====================================================
describe('hashContext', () => {
  it('should generate consistent hash for same input', () => {
    const h1 = hashContext('快件已到达上海', '2026-06-23 14:00');
    const h2 = hashContext('快件已到达上海', '2026-06-23 14:00');
    assert.equal(h1, h2);
  });

  it('should generate different hash for different input', () => {
    const h1 = hashContext('快件已到达上海', '2026-06-23 14:00');
    const h2 = hashContext('快件已到达北京', '2026-06-23 14:00');
    assert.notEqual(h1, h2);
  });
});

// =====================================================
// 关键节点判断
// =====================================================
describe('isKeyEvent', () => {
  it('should return true for arrived_city', () => {
    assert.equal(isKeyEvent(StatusCategory.ARRIVED_CITY), true);
  });

  it('should return true for signed', () => {
    assert.equal(isKeyEvent(StatusCategory.SIGNED), true);
  });

  it('should return true for abnormal', () => {
    assert.equal(isKeyEvent(StatusCategory.ABNORMAL), true);
  });

  it('should return false for other statuses', () => {
    assert.equal(isKeyEvent(StatusCategory.COLLECTED), false);
    assert.equal(isKeyEvent(StatusCategory.IN_TRANSIT), false);
    assert.equal(isKeyEvent(StatusCategory.DELIVERING), false);
    assert.equal(isKeyEvent(StatusCategory.OTHER), false);
  });
});

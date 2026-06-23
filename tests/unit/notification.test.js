/**
 * 单元测试：通知决策引擎
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 模拟通知决策逻辑（核心逻辑直接内联测试）

/**
 * 判断是否应推送通知
 */
function shouldNotify({
  category,           // 状态分类
  lastNotifiedStatus, // 最后推送的状态
  muted,              // 是否静音
  notifyOnArrival,    // 用户设置: 到达通知
  notifyOnSigned,     // 用户设置: 签收通知
  notifyOnAbnormal,   // 用户设置: 异常通知
}) {
  // 静音包裹 → 不推送
  if (muted) return { should: false, reason: 'muted' };

  // 重复状态 → 不推送
  if (category === lastNotifiedStatus) {
    return { should: false, reason: 'duplicate' };
  }

  // 用户设置检查
  if (category === 'arrived_city' && !notifyOnArrival) {
    return { should: false, reason: 'user_disabled' };
  }
  if (category === 'signed' && !notifyOnSigned) {
    return { should: false, reason: 'user_disabled' };
  }
  if (category === 'abnormal' && !notifyOnAbnormal) {
    return { should: false, reason: 'user_disabled' };
  }

  // 只推送关键节点
  const keyEvents = ['arrived_city', 'signed', 'abnormal'];
  if (!keyEvents.includes(category)) {
    return { should: false, reason: 'not_key_event' };
  }

  return { should: true, reason: 'allowed' };
}

describe('Notification Decision Engine', () => {
  const defaultConfig = {
    lastNotifiedStatus: null,
    muted: false,
    notifyOnArrival: true,
    notifyOnSigned: true,
    notifyOnAbnormal: true,
  };

  it('should notify on arrived_city', () => {
    const result = shouldNotify({ ...defaultConfig, category: 'arrived_city' });
    assert.equal(result.should, true);
  });

  it('should notify on signed', () => {
    const result = shouldNotify({ ...defaultConfig, category: 'signed' });
    assert.equal(result.should, true);
  });

  it('should notify on abnormal', () => {
    const result = shouldNotify({ ...defaultConfig, category: 'abnormal' });
    assert.equal(result.should, true);
  });

  it('should NOT notify on in_transit', () => {
    const result = shouldNotify({ ...defaultConfig, category: 'in_transit' });
    assert.equal(result.should, false);
    assert.equal(result.reason, 'not_key_event');
  });

  it('should NOT notify on collected', () => {
    const result = shouldNotify({ ...defaultConfig, category: 'collected' });
    assert.equal(result.should, false);
  });

  it('should NOT notify on duplicate status', () => {
    const result = shouldNotify({
      ...defaultConfig,
      category: 'arrived_city',
      lastNotifiedStatus: 'arrived_city',
    });
    assert.equal(result.should, false);
    assert.equal(result.reason, 'duplicate');
  });

  it('should NOT notify on muted parcel', () => {
    const result = shouldNotify({
      ...defaultConfig,
      category: 'arrived_city',
      muted: true,
    });
    assert.equal(result.should, false);
    assert.equal(result.reason, 'muted');
  });

  it('should respect user disabled notifications', () => {
    const result = shouldNotify({
      ...defaultConfig,
      category: 'arrived_city',
      notifyOnArrival: false,
    });
    assert.equal(result.should, false);
    assert.equal(result.reason, 'user_disabled');
  });

  it('should respect user disabled signed notifications', () => {
    const result = shouldNotify({
      ...defaultConfig,
      category: 'signed',
      notifyOnSigned: false,
    });
    assert.equal(result.should, false);
  });
});

describe('Quiet Hours Calculation', () => {
  /**
   * 计算免打扰调度时间
   */
  function calculateScheduleTime(now, quietHoursStart, quietHoursEnd) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = quietHoursStart.split(':').map(Number);
    const [endH, endM] = quietHoursEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;

    // 跨天处理
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
    }

    const adjustedCurrent = currentMinutes < startMinutes
      ? currentMinutes + 24 * 60
      : currentMinutes;

    if (adjustedCurrent >= startMinutes && adjustedCurrent < endMinutes) {
      // 在免打扰时段内 → 延迟
      const delayed = new Date(now);
      delayed.setHours(endH, endM + 1, 0, 0);
      if (delayed <= now) {
        delayed.setDate(delayed.getDate() + 1);
      }
      return delayed;
    }

    return now;
  }

  it('should not delay outside quiet hours', () => {
    const now = new Date('2026-06-23T10:00:00');
    const scheduled = calculateScheduleTime(now, '22:00', '08:00');
    assert.equal(scheduled.getTime(), now.getTime());
  });

  it('should delay during quiet hours (evening)', () => {
    const now = new Date('2026-06-23T23:00:00');
    const scheduled = calculateScheduleTime(now, '22:00', '08:00');
    assert.ok(scheduled > now);
    assert.equal(scheduled.getHours(), 8);
    assert.equal(scheduled.getMinutes(), 1);
  });

  it('should delay during quiet hours (early morning)', () => {
    const now = new Date('2026-06-23T05:00:00');
    const scheduled = calculateScheduleTime(now, '22:00', '08:00');
    assert.ok(scheduled > now);
    assert.equal(scheduled.getHours(), 8);
    assert.equal(scheduled.getMinutes(), 1);
  });

  it('should not delay at exact end time', () => {
    const now = new Date('2026-06-23T08:00:00');
    const scheduled = calculateScheduleTime(now, '22:00', '08:00');
    assert.equal(scheduled.getTime(), now.getTime());
  });

  it('should handle custom quiet hours', () => {
    const now = new Date('2026-06-23T23:00:00');
    const scheduled = calculateScheduleTime(now, '23:30', '07:00');
    assert.equal(scheduled.getTime(), now.getTime());
  });

  it('should delay until next day for late night', () => {
    const now = new Date('2026-06-23T23:30:00');
    const scheduled = calculateScheduleTime(now, '23:00', '07:00');
    assert.ok(scheduled > now);
    assert.equal(scheduled.getHours(), 7);
    assert.equal(scheduled.getMinutes(), 1);
  });
});

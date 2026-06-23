/**
 * 云函数: 物流跟踪工作器
 *
 * 定时触发器，每 2 小时执行一次。
 * 查询所有"跟踪中"的包裹，调用快递100 API 获取最新状态。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const $ = db.command.aggregate;

// 快递100 API 配置
const KUAIDI100_KEY = process.env.KUAIDI100_KEY;
const KUAIDI100_CUSTOMER = process.env.KUAIDI100_CUSTOMER;

// 关键状态分类规则
const KEY_STATUS_KEYWORDS = {
  arrived_city: ['到达目的地', '已到达', '到达', '到市'],
  signed: ['已签收', '签收人', '已投递', '已放入'],
  abnormal: ['退回', '异常', '延误', '滞留', '拒收', '无人'],
};

/**
 * 主入口
 */
exports.main = async (event, context) => {
  console.log('[TrackingWorker] Starting tracking cycle');

  // 获取所有需要跟踪的包裹
  const parcels = await getTrackableParcels();
  console.log(`[TrackingWorker] Found ${parcels.length} parcels to track`);

  let updated = 0;
  let notified = 0;

  for (const parcel of parcels) {
    try {
      const result = await queryKuaidi100(parcel.tracking_number, parcel.courier_code);
      if (!result) continue;

      const statusChanged = await processTrackingResult(parcel, result);
      if (statusChanged) updated++;
      if (result.isKeyEvent) notified++;
    } catch (err) {
      console.error(`[TrackingWorker] Error tracking ${parcel.tracking_number}:`, err.message);
      await incrementFailCount(parcel);
    }
  }

  console.log(`[TrackingWorker] Done. Updated: ${updated}, Notified: ${notified}`);
  return { updated, notified, total: parcels.length };
};

/**
 * 获取需要跟踪的包裹列表
 */
async function getTrackableParcels() {
  const result = await db.collection('parcels')
    .where({
      tracking_enabled: true,
      status: $.in(['transit', 'arrived', 'abnormal']),
    })
    .limit(100)
    .get();

  return result.data;
}

/**
 * 调用快递100 API 查询物流状态
 *
 * 使用免费版实时查询接口
 */
async function queryKuaidi100(trackingNumber, courierCode) {
  if (!KUAIDI100_KEY || !KUAIDI100_CUSTOMER) {
    console.warn('[Kuaidi100] API key not configured');
    return null;
  }

  try {
    const param = JSON.stringify({
      company: courierCode,
      num: trackingNumber,
      from: '',  // 可选，发件地
      to: '',    // 可选，目的地
    });

    // 生成签名
    const sign = crypto
      .createHash('md5')
      .update(param + KUAIDI100_KEY + KUAIDI100_CUSTOMER)
      .digest('hex')
      .toUpperCase();

    const response = await cloud.callFunction({
      name: 'http-request',
      data: {
        url: 'https://poll.kuaidi100.com/poll/query.do',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `customer=${KUAIDI100_CUSTOMER}&sign=${sign}&param=${encodeURIComponent(param)}`,
      },
    });

    const data = response.result;
    if (!data) return null;

    const result = JSON.parse(data);

    if (result.result === false) {
      console.warn(`[Kuaidi100] Query failed: ${result.message}`);
      return null;
    }

    // 解析最新状态
    const records = result.data || [];
    if (records.length === 0) return null;

    const latest = records[records.length - 1];
    const category = classifyStatus(latest.context);

    return {
      latest: {
        context: latest.context,
        time: latest.time,
        city: extractCity(latest.context),
      },
      allRecords: records,
      isKeyEvent: isKeyStatus(category),
      statusCategory: category,
    };
  } catch (err) {
    console.error(`[Kuaidi100] API error for ${trackingNumber}:`, err.message);
    return null;
  }
}

/**
 * 处理查询结果
 */
async function processTrackingResult(parcel, result) {
  const latest = result.latest;

  // 检测是否有新轨迹
  const lastRecord = await db.collection('tracking_records')
    .where({ parcel_id: parcel._id })
    .orderBy('time', 'desc')
    .limit(1)
    .get();

  // 如果是相同的最新轨迹，跳过
  if (lastRecord.data.length > 0 &&
      lastRecord.data[0].context === latest.context) {
    // 只更新时间戳
    await db.collection('parcels').doc(parcel._id).update({
      data: { last_tracked_at: db.serverDate() },
    });
    return false;
  }

  // 保存新轨迹
  const statusCategory = result.statusCategory;

  await db.collection('tracking_records').add({
    data: {
      parcel_id: parcel._id,
      tracking_number: parcel.tracking_number,
      context: latest.context,
      status_category: statusCategory,
      city: latest.city || '',
      time: new Date(latest.time),
      recorded_at: db.serverDate(),
      is_key_event: result.isKeyEvent,
    },
  });

  // 更新包裹状态
  const updateData = {
    last_tracked_at: db.serverDate(),
    updated_at: db.serverDate(),
  };

  if (statusCategory === 'arrived_city') {
    updateData.status = 'arrived';
    updateData.arrived_at = db.serverDate();
    updateData.destination_city = latest.city || parcel.destination_city;
  } else if (statusCategory === 'signed') {
    updateData.status = 'signed';
    updateData.signed_at = db.serverDate();
  } else if (statusCategory === 'delivering') {
    if (parcel.status === 'transit') {
      updateData.status = 'arrived';
    }
  }

  await db.collection('parcels').doc(parcel._id).update({ data: updateData });

  // 如果是关键节点，创建通知队列
  if (result.isKeyEvent) {
    await createNotification(parcel, statusCategory, latest);
  }

  return true;
}

/**
 * 分类物流状态
 */
function classifyStatus(context) {
  const text = context.toLowerCase();

  for (const [category, keywords] of Object.entries(KEY_STATUS_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        return category;
      }
    }
  }

  // 更精确匹配
  if (/揽收|已收件/.test(text)) return 'collected';
  if (/派送|快递员|配送/.test(text)) return 'delivering';
  if (/中转|分拨|发往|发出/.test(text)) return 'in_transit';

  return 'other';
}

/**
 * 判断是否为关键节点
 */
function isKeyStatus(category) {
  return ['arrived_city', 'signed', 'abnormal'].includes(category);
}

/**
 * 从文本中提取城市
 */
function extractCity(context) {
  const match = context.match(/(?:到达|在|抵达)([\u4e00-\u9fa5]{2,4}(?:市|区|县))/);
  return match ? match[1] : '';
}

/**
 * 创建通知队列
 */
async function createNotification(parcel, category, latest) {
  // 检查是否已推送过相同状态
  if (parcel.last_notified_status === category) {
    console.log(`[TrackingWorker] Already notified ${category} for ${parcel.tracking_number}`);
    return;
  }

  // 检查是否在免打扰时段
  const user = await db.collection('users')
    .where({ openid: parcel.user_openid })
    .get();

  const settings = user.data[0]?.settings || {};
  const now = new Date();
  const scheduledAt = calculateScheduleTime(now, settings);

  // 入队通知
  await db.collection('notification_queue').add({
    data: {
      user_openid: parcel.user_openid,
      parcel_id: parcel._id,
      template_id: category === 'arrived_city'
        ? 'TEMPLATE_ARRIVED'   // 替换为实际模板 ID
        : 'TEMPLATE_SIGNED',   // 替换为实际模板 ID
      title: category === 'arrived_city' ? '包裹已到达目的地城市' : '包裹已签收',
      data: {
        thing1: { value: parcel.courier },
        character_string2: { value: maskTracking(parcel.tracking_number) },
        thing3: { value: latest.city || parcel.destination_city || '' },
        date4: { value: latest.time || new Date().toISOString() },
      },
      status: 'pending',
      status_category: category,
      scheduled_at: scheduledAt,
      created_at: db.serverDate(),
    },
  });

  // 更新最后通知状态
  await db.collection('parcels').doc(parcel._id).update({
    data: { last_notified_status: category },
  });
}

/**
 * 计算计划发送时间（考虑免打扰时段）
 */
function calculateScheduleTime(now, settings) {
  if (!settings.quiet_hours_enabled) {
    return now;
  }

  const start = settings.quiet_hours_start || '22:00';
  const end = settings.quiet_hours_end || '08:00';
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  let endMinutes = endH * 60 + endM;

  // 跨天处理（如 22:00 - 08:00）
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const adjustedCurrent = currentMinutes < startMinutes
    ? currentMinutes + 24 * 60
    : currentMinutes;

  if (adjustedCurrent >= startMinutes && adjustedCurrent < endMinutes) {
    // 在免打扰时段内 → 延迟到结束时间后1分钟
    const delayedDate = new Date(now);
    delayedDate.setHours(endH, endM + 1, 0, 0);
    if (delayedDate <= now) {
      delayedDate.setDate(delayedDate.getDate() + 1);
    }
    return delayedDate;
  }

  return now;
}

/**
 * 运单号脱敏
 */
function maskTracking(number) {
  if (!number) return '';
  if (number.length <= 8) {
    return number.slice(0, 4) + '****';
  }
  return number.slice(0, 4) + '****' + number.slice(-4);
}

/**
 * 递增失败计数
 */
async function incrementFailCount(parcel) {
  await db.collection('parcels').doc(parcel._id).update({
    data: {
      track_fail_count: cloud.database().command.inc(1),
      last_tracked_at: db.serverDate(),
    },
  });
}

/**
 * 云函数: 通知发送器
 *
 * 定时触发器，每分钟执行一次。
 * 从 notification_queue 读取待发送通知，调用微信订阅消息 API 发送。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_BATCH = 10; // 每次最多处理 10 条

/**
 * 主入口
 */
exports.main = async (event, context) => {
  console.log('[NotificationSender] Checking queue...');

  // 获取待发送的通知
  const queue = await db.collection('notification_queue')
    .where({
      status: 'pending',
      scheduled_at: db.command.lte(new Date()),
    })
    .orderBy('scheduled_at', 'asc')
    .limit(MAX_BATCH)
    .get();

  if (queue.data.length === 0) {
    console.log('[NotificationSender] No pending notifications');
    return { sent: 0 };
  }

  let sentCount = 0;
  let failCount = 0;

  for (const item of queue.data) {
    try {
      // 检查推送频率
      const canSend = await checkRateLimit(item.user_openid);
      if (!canSend) {
        // 频率超限，延迟到下个周期
        await db.collection('notification_queue').doc(item._id).update({
          data: {
            status: 'delayed',
            delay_reason: 'rate_limit',
            scheduled_at: new Date(Date.now() + 60 * 60 * 1000), // 1小时后重试
          },
        });
        continue;
      }

      // 发送微信订阅消息
      const result = await sendSubscribeMessage(item);

      if (result.success) {
        // 标记为已发送
        await db.collection('notification_queue').doc(item._id).update({
          data: { status: 'sent', sent_at: db.serverDate() },
        });

        // 写入发送日志
        await db.collection('notify_log').add({
          data: {
            user_openid: item.user_openid,
            parcel_id: item.parcel_id,
            queue_id: item._id,
            template_id: item.template_id,
            status_category: item.status_category,
            result: 'sent',
            sent_at: db.serverDate(),
            created_at: db.serverDate(),
          },
        });

        sentCount++;
      } else if (result.errcode === 43101) {
        // 用户取消授权 → 不再尝试
        await db.collection('notification_queue').doc(item._id).update({
          data: { status: 'cancelled', fail_reason: 'user_deny' },
        });
        failCount++;
      } else {
        // 其他错误，延迟重试
        await db.collection('notification_queue').doc(item._id).update({
          data: {
            status: 'delayed',
            delay_reason: result.errmsg || 'unknown',
            scheduled_at: new Date(Date.now() + 5 * 60 * 1000), // 5分钟重试
          },
        });
        failCount++;
      }
    } catch (err) {
      console.error('[NotificationSender] Error:', err);
      failCount++;
    }
  }

  console.log(`[NotificationSender] Done. Sent: ${sentCount}, Failed: ${failCount}`);
  return { sent: sentCount, failed: failCount };
};

/**
 * 发送微信订阅消息
 */
async function sendSubscribeMessage(item) {
  const wxContext = cloud.getWXContext();

  try {
    // 调用微信 API 发送订阅消息
    const result = await cloud.openapi.subscribeMessage.send({
      touser: item.user_openid,
      page: `pages/detail/detail?id=${item.parcel_id}`,
      data: item.data,
      template_id: item.template_id,
      miniprogram_state: 'trial',  // 正式版改为 'formal'
    });

    return { success: true, ...result };
  } catch (err) {
    return { success: false, errcode: err.errCode, errmsg: err.errMsg };
  }
}

/**
 * 检查用户每日推送频率
 */
async function checkRateLimit(openid) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 获取用户设置的每日最大通知数
  const user = await db.collection('users').where({ openid }).get();
  const maxNotifications = user.data[0]?.settings?.max_daily_notifications || 20;

  // 统计今日已发送数量
  const countResult = await db.collection('notify_log')
    .where({
      user_openid: openid,
      sent_at: db.command.gte(today).lt(tomorrow),
    })
    .count();

  return countResult.total < maxNotifications;
}

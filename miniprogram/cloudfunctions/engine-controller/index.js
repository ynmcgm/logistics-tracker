/**
 * 云函数: 引擎控制器
 *
 * 功能:
 *  1. 定时触发（每日 3 次: 08:00 / 14:00 / 20:00）
 *     自动同步各平台已绑定用户的订单
 *  2. HTTP 触发（手动触发指定平台的同步）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 引擎云托管服务地址（由 CloudBase 环境变量注入）
const ENGINE_HOST = process.env.ENGINE_HOST || 'http://logistics-engine:3000';

/**
 * 主入口
 */
exports.main = async (event, context) => {
  const action = event.action || 'autoSync';

  switch (action) {
    case 'autoSync':
      return await autoSyncAll();

    case 'syncPlatform':
      return await syncPlatform(event.platform, event.user_openid);

    case 'checkSessions':
      return await checkAllSessions();

    default:
      return { code: 1001, error: `Unknown action: ${action}` };
  }
};

/**
 * 自动同步所有已绑定用户的订单
 */
async function autoSyncAll() {
  console.log('[EngineController] Auto sync started');

  // 获取所有有活跃 session 的用户
  const sessions = await db.collection('sessions')
    .where({ status: 'active' })
    .get();

  // 按用户+平台分组
  const tasks = {};
  for (const s of sessions.data) {
    const key = `${s.user_openid}:${s.platform}`;
    tasks[key] = { user_openid: s.user_openid, platform: s.platform };
  }

  console.log(`[EngineController] Found ${Object.keys(tasks).length} sync tasks`);

  let successCount = 0;
  let failCount = 0;

  for (const [key, task] of Object.entries(tasks)) {
    try {
      await syncPlatform(task.platform, task.user_openid);
      successCount++;
    } catch (err) {
      console.error(`[EngineController] Sync failed for ${key}:`, err.message);
      failCount++;
    }
  }

  console.log(`[EngineController] Auto sync done. Success: ${successCount}, Fail: ${failCount}`);
  return { success: successCount, fail: failCount, total: Object.keys(tasks).length };
}

/**
 * 同步单个用户的单个平台
 */
async function syncPlatform(platform, userOpenid) {
  console.log(`[EngineController] Syncing ${platform} for ${userOpenid}`);

  try {
    // 通过云托管 HTTP 调用引擎
    // 在 CloudBase 环境中，可以用内网地址访问云托管
    const response = await cloud.callFunction({
      name: 'http-request',
      data: {
        url: `${ENGINE_HOST}/sync`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, user_id: userOpenid }),
      },
    });

    const result = response.result;

    if (result?.code === 0) {
      console.log(`[EngineController] Sync done: ${result.data?.newParcels || 0} new parcels`);
      return { success: true, newParcels: result.data?.newParcels || 0 };
    }

    throw new Error(result?.error || 'Unknown error');
  } catch (err) {
    console.error(`[EngineController] Sync failed:`, err.message);

    // 如果是 session 过期
    if (err.message.includes('Session expired')) {
      await db.collection('sessions')
        .where({ user_openid: userOpenid, platform })
        .update({ data: { status: 'expired' } });
    }

    throw err;
  }
}

/**
 * 检查所有 session 的有效性（每日执行）
 */
async function checkAllSessions() {
  console.log('[EngineController] Session check started');

  const sessions = await db.collection('sessions')
    .where({ status: 'active' })
    .get();

  let expiredCount = 0;

  for (const s of sessions.data) {
    try {
      // 通过引擎的 validate 接口检查
      const response = await cloud.callFunction({
        name: 'http-request',
        data: {
          url: `${ENGINE_HOST}/validate`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: s.platform, user_id: s.user_openid }),
        },
      });

      const result = response.result;
      if (result?.data?.valid === false) {
        await db.collection('sessions').doc(s._id).update({
          data: { status: 'expired', last_verified: db.serverDate() },
        });
        expiredCount++;
      } else {
        await db.collection('sessions').doc(s._id).update({
          data: { last_verified: db.serverDate(), fail_count: 0 },
        });
      }
    } catch (err) {
      console.error(`[EngineController] Session check error:`, err.message);
    }
  }

  console.log(`[EngineController] Session check done. Expired: ${expiredCount}`);
  return { total: sessions.data.length, expired: expiredCount };
}

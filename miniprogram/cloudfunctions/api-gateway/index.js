/**
 * 云函数: API 网关
 *
 * 所有小程序前端请求的入口。
 * 路由分发到对应处理逻辑。
 */
const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 引擎云托管服务地址（由 CloudBase 环境变量注入）
const ENGINE_HOST = process.env.ENGINE_HOST || 'https://logistics-engine-273836-6-1301681040.sh.run.tcloudbase.com';

/**
 * 主入口
 */
exports.main = async (event, context) => {
  const { action, data } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  // 所有接口鉴权
  if (!openid) {
    return { code: 1002, error: 'Unauthorized' };
  }

  try {
    switch (action) {
      // ===== 账号绑定 =====
      case 'authBind': {
        const { platform } = data;
        if (!platform) return { code: 1001, error: 'platform required' };

        try {
          const engineService = await getEngineService();
          const result = await engineService.post('/login', {
            platform,
            user_id: openid,
          });

          // 保存 session_id 到临时存储
          await db.collection('login_sessions').add({
            data: {
              session_id: result.data.sessionId,
              user_openid: openid,
              platform,
              qr_base64: result.data.qrBase64,
              status: 'pending',
              created_at: db.serverDate(),
            },
          });

          return { code: 0, data: result.data };
        } catch (err) {
          if (err.message === 'Engine service not configured') {
            return { code: 1006, error: '扫码登录引擎尚未部署，请先升级 CloudBase 套餐到个人版(¥19.9/月)' };
          }
          throw err;
        }
      }

      case 'authStatus': {
        const { session_id, platform } = data;
        const session = await db.collection('login_sessions')
          .where({ session_id, user_openid: openid })
          .get();

        if (!session.data.length) {
          return { code: 1003, error: 'Session not found' };
        }

        const loginSession = session.data[0];

        // 如果已经是终态，直接返回
        if (loginSession.status === 'success' || loginSession.status === 'expired') {
          return { code: 0, data: { status: loginSession.status } };
        }

        // 向引擎查询最新扫码状态
        try {
          const engineService = await getEngineService();
          const result = await engineService.post('/loginStatus', {
            platform: platform || loginSession.platform,
            session_id,
            user_id: openid,
          });

          const engineStatus = result.data?.status;

          // 扫描成功：保存 cookies 到 sessions 集合
          if (engineStatus === 'success' && result.data?.cookies) {
            // 写入 sessions 集合
            await db.collection('sessions').add({
              data: {
                user_openid: openid,
                platform: loginSession.platform,
                status: 'active',
                cookies: result.data.cookies,
                created_at: db.serverDate(),
                updated_at: db.serverDate(),
              },
            });

            // 更新 login_sessions 状态
            await db.collection('login_sessions')
              .where({ _id: loginSession._id })
              .update({
                data: {
                  status: 'success',
                  bind_at: db.serverDate(),
                  updated_at: db.serverDate(),
                },
              });

            return { code: 0, data: { status: 'success' } };
          }

          // QR 码过期
          if (engineStatus === 'expired') {
            await db.collection('login_sessions')
              .where({ _id: loginSession._id })
              .update({ data: { status: 'expired', updated_at: db.serverDate() } });
            return { code: 0, data: { status: 'expired' } };
          }
        } catch (err) {
          // 引擎访问失败时，返回 DB 中已有的状态，不阻塞前端
          console.error('[API] Engine loginStatus error:', err.message);
        }

        // 仍在等待扫码
        return { code: 0, data: { status: 'pending' } };
      }

      case 'authUnbind': {
        const { platform } = data;
        await db.collection('sessions')
          .where({ user_openid: openid, platform })
          .update({ data: { status: 'revoked', revoked_at: db.serverDate() } });

        return { code: 0, data: { unbind_at: new Date().toISOString() } };
      }

      case 'authBindings': {
        const sessions = await db.collection('sessions')
          .where({ user_openid: openid })
          .get();

        const platforms = ['pdd', 'jd', 'taobao'];
        const bindings = platforms.map(p => {
          const s = sessions.data.find(x => x.platform === p);
          return {
            platform: p,
            status: s?.status || 'not_bind',
            bind_at: s?.created_at || null,
          };
        });

        return { code: 0, data: { bindings } };
      }

      // ===== 包裹管理 =====
      case 'getParcels': {
        const { status, page = 1, pageSize = 20 } = data || {};
        const query = { user_openid: openid };

        if (status && status !== 'all') {
          const statusList = status.split(',');
          query.status = { $in: statusList };
        } else {
          // 默认排除已归档
          query.status = { $nin: ['archived'] };
        }

        const countResult = await db.collection('parcels')
          .where(query)
          .count();

        const parcels = await db.collection('parcels')
          .where(query)
          .orderBy('updated_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get();

        return {
          code: 0,
          data: {
            parcels: parcels.data.map(formatParcel),
            total: countResult.total,
            page,
            page_size: pageSize,
          },
        };
      }

      case 'getParcelDetail': {
        const { parcel_id } = data;
        const parcel = await db.collection('parcels')
          .where({ _id: parcel_id, user_openid: openid })
          .get();

        if (!parcel.data.length) {
          return { code: 1003, error: 'Parcel not found' };
        }

        const records = await db.collection('tracking_records')
          .where({ parcel_id })
          .orderBy('time', 'desc')
          .limit(100)
          .get();

        return {
          code: 0,
          data: {
            ...formatParcel(parcel.data[0]),
            tracking_records: records.data,
          },
        };
      }

      case 'toggleMute': {
        const { parcel_id, muted } = data;
        await db.collection('parcels')
          .where({ _id: parcel_id, user_openid: openid })
          .update({ data: { muted, updated_at: db.serverDate() } });
        return { code: 0, data: { muted } };
      }

      case 'deleteParcel': {
        const { parcel_id } = data;
        // 删除包裹
        await db.collection('parcels')
          .where({ _id: parcel_id, user_openid: openid })
          .remove();
        // 删除关联轨迹
        await db.collection('tracking_records')
          .where({ parcel_id })
          .remove();
        return { code: 0, data: { deleted_at: new Date().toISOString() } };
      }

      case 'getStats': {
        // 月度统计
        const allParcels = await db.collection('parcels')
          .where({ user_openid: openid })
          .get();

        const total = allParcels.data.length;
        const currentMonth = allParcels.data.filter(p => {
          const t = new Date(p.created_at);
          const now = new Date();
          return t.getMonth() === now.getMonth() &&
                 t.getFullYear() === now.getFullYear();
        }).length;

        // 各平台分布
        const platforms = { pdd: 0, jd: 0, taobao: 0 };
        allParcels.data.forEach(p => {
          if (platforms[p.platform] !== undefined) platforms[p.platform]++;
        });

        // 快递公司分布
        const courierCount = {};
        allParcels.data.forEach(p => {
          courierCount[p.courier] = (courierCount[p.courier] || 0) + 1;
        });
        const couriers = Object.entries(courierCount)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        return {
          code: 0,
          data: {
            total,
            current_month: currentMonth,
            platforms,
            couriers,
          },
        };
      }

      // ===== 设置 =====
      case 'getSettings': {
        const user = await db.collection('users')
          .where({ openid })
          .get();

        const defaults = {
          quiet_hours_enabled: true,
          quiet_hours_start: '22:00',
          quiet_hours_end: '08:00',
          notify_on_arrival: true,
          notify_on_signed: true,
          notify_on_abnormal: true,
          max_daily_notifications: 20,
        };

        return {
          code: 0,
          data: { ...defaults, ...(user.data[0]?.settings || {}) },
        };
      }

      case 'updateSettings': {
        const settings = data;
        await db.collection('users').where({ openid }).update({
          data: { settings, updated_at: db.serverDate() },
        });
        return { code: 0, data: { updated: true } };
      }

      case 'triggerSync': {
        const { platform } = data;
        // 调用云托管引擎同步
        const engineService = await getEngineService();
        const result = await engineService.post('/sync', {
          platform,
          user_id: openid,
        });
        return { code: 0, data: { task_id: `sync_${Date.now()}`, ...result.data } };
      }

      default:
        return { code: 1001, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error('[API] Error:', err);
    return { code: 1005, error: err.message };
  }
};

/**
 * 格式化包裹数据
 */
function formatParcel(p) {
  return {
    id: p._id,
    platform: p.platform,
    tracking_number: p.tracking_number,
    courier: p.courier,
    courier_code: p.courier_code,
    product_name: p.product_name,
    status: p.status,
    muted: p.muted || false,
    destination_city: p.destination_city || '',
    arrived_at: p.arrived_at,
    signed_at: p.signed_at,
    order_time: p.order_time,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/**
 * 获取引擎云托管服务
 */
function getEngineService() {
  return {
    post: async (path, body) => {
      return new Promise((resolve, reject) => {
        const url = new URL(`${ENGINE_HOST}${path}`);
        const data = Buffer.from(JSON.stringify(body), 'utf-8');
        const options = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };
        const req = https.request(options, (res) => {
          let chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            try { resolve(JSON.parse(text)); }
            catch { resolve({ raw: text }); }
          });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    },
  };
}

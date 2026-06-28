/**
 * 拼多多引擎入口
 *
 * 实现 EngineBase 接口，是平台适配器模式的第一个实现。
 *
 * 功能:
 *  1. login()    - QR 扫码登录
 *  2. syncOrders() - 同步近 3 个月订单
 *  3. validate() - 验证 session 有效性
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { getContext, restoreContext } from '../common/browser.js';
import { loadSession, validateSession, markExpired, incrementFailCount } from '../common/session.js';
import { scrapeOrders } from './orders.js';
import { startLogin, pollLoginStatus, startSmsLogin, verifySmsCode } from './login.js';

const PLATFORM = 'pdd';

/**
 * 拼多多引擎
 */
class PDDEngine {
  /**
   * @param {object} db - 云数据库实例
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * 发起扫码登录
   *
   * @param {string} userId
   * @returns {Promise<{ sessionId: string, qrBase64: string }>}
   */
  async login(userId) {
    return startLogin(userId, this.db);
  }

  /**
   * 轮询登录状态（使用 DB）
   *
   * @param {string} sessionId
   * @param {string} userId
   * @returns {Promise<{ status: string, bind_at?: string }>}
   */
  async checkLoginStatus(sessionId, userId) {
    return pollLoginStatus(sessionId, this.db, userId);
  }

  /**
   * 轮询登录状态（无 DB，仅检查 QR 状态）
   * 供云函数直接调用，结果由调用方写入 DB。
   *
   * @param {string} sessionId - 二维码会话 ID
   * @param {string} userId - 微信用户 openid（用于查找浏览器 context）
   * @returns {Promise<{ status: string, cookies?: Array, user_nick?: string }>}
   */
  async checkLoginStatusRaw(sessionId, userId) {
    return pollLoginStatus(sessionId, null, userId);
  }

  /**
   * 第 1 步：启动 SMS 验证码登录
   *
   * @param {string} userId
   * @param {string} phone - 用户手机号
   * @returns {Promise<{ success: boolean, sessionId: string, error?: string }>}
   */
  async smsLogin(userId, phone) {
    return startSmsLogin(userId, phone);
  }

  /**
   * 第 2 步：验证 SMS 验证码并完成登录
   *
   * @param {string} sessionId
   * @param {string} code - 6 位短信验证码
   * @returns {Promise<{ success: boolean, status?: string, error?: string }>}
   */
  async verifySms(sessionId, code) {
    return verifySmsCode(sessionId, code, this.db);
  }

  /**
   * 同步近 3 个月的订单
   *
   * 步骤:
   *  1. 从数据库加载 session
   *  2. 恢复登录态
   *  3. 打开订单页抓取
   *  4. 解析运单号
   *  5. 写入数据库
   *
   * @param {string} userId
   * @returns {Promise<{ newParcels: number, orders: Array }>}
   */
  async syncOrders(userId) {
    // 1. 加载 session
    const sessionData = await loadSession(this.db, userId, PLATFORM);
    if (!sessionData) {
      throw new Error('No active session found. Please login first.');
    }

    // 2. 恢复登录态
    const context = await restoreContext(userId, PLATFORM, JSON.stringify(sessionData.cookies));
    const page = await context.newPage();

    try {
      // 3. 验证 session 有效性
      const isValid = await validateSession(context, PLATFORM);
      if (!isValid) {
        await markExpired(this.db, userId, PLATFORM);
        throw new Error('Session expired. Please re-login.');
      }

      // 4. 抓取订单
      console.log(`[PDD] Starting order sync for user ${userId}`);
      const orders = await scrapeOrders(page);

      // 5. 筛选需要进行中跟踪的订单
      const activeOrders = orders.filter(o =>
        o.status === '已发货' || o.status === '待收货'
      );

      // 6. 写入数据库（新包裹）
      let newParcels = 0;
      for (const order of activeOrders) {
        if (!order.trackingNumber) {
          console.log(`[PDD] Order ${order.orderId}: no tracking number, skipping`);
          continue;
        }

        const existing = await this.db.collection('parcels').findOne({
          user_openid: userId,
          tracking_number: order.trackingNumber,
        });

        if (!existing) {
          await this.db.collection('parcels').insertOne({
            user_openid: userId,
            platform: PLATFORM,
            order_id: order.orderId,
            tracking_number: order.trackingNumber,
            courier: order.courier || '未知快递',
            courier_code: order.courierCode || '',
            product_name: order.productName || '未知商品',
            status: 'transit',
            tracking_enabled: true,
            muted: false,
            destination_city: '',
            last_notified_status: null,
            order_time: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          });
          newParcels++;
          console.log(`[PDD] New parcel: ${order.productName} (${order.trackingNumber})`);
        } else {
          // 更新最后同步时间
          await this.db.collection('parcels').updateOne(
            { _id: existing._id },
            { $set: { updated_at: new Date() } }
          );
        }
      }

      return { newParcels, orders: activeOrders };
    } finally {
      await page.close();
    }
  }

  /**
   * 验证 session 是否仍然有效
   *
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async validate(userId) {
    const sessionData = await loadSession(this.db, userId, PLATFORM);
    if (!sessionData) return false;

    try {
      const context = await restoreContext(
        userId, PLATFORM, JSON.stringify(sessionData.cookies)
      );
      const isValid = await validateSession(context, PLATFORM);
      await context.close();

      if (!isValid) {
        await markExpired(this.db, userId, PLATFORM);
      }

      return isValid;
    } catch (err) {
      console.error(`[PDD] Session validation error:`, err.message);
      await incrementFailCount(this.db, userId, PLATFORM);
      return false;
    }
  }

  /**
   * 解绑（删除 session）
   *
   * @param {string} userId
   */
  async unbind(userId) {
    await this.db.collection('sessions').updateOne(
      { user_openid: userId, platform: PLATFORM },
      { $set: { status: 'revoked', revoked_at: new Date() } }
    );
  }
}

export default PDDEngine;

/**
 * 账号绑定页
 */
const app = getApp();

Page({
  data: {
    platforms: [
      { key: 'pdd', name: '拼多多', icon: '🛒', status: 'not_bind', statusText: '未绑定' },
      { key: 'jd', name: '京东', icon: '🛍️', status: 'not_bind', statusText: '未绑定' },
      { key: 'taobao', name: '淘宝', icon: '🧧', status: 'not_bind', statusText: '未绑定' },
    ],
    showQR: false,           // 是否显示二维码弹窗
    qrBase64: '',            // 二维码 base64
    currentPlatform: '',     // 当前操作的平台
    loginStatus: 'pending',  // pending | success | expired
    pollingTimer: null,
    // SMS 模式
    loginMode: 'qr',         // 'qr' | 'sms'
    phone: '',               // 手机号
    smsCode: '',             // 短信验证码
    smsSessionId: '',        // sms 会话 ID
    smsSent: false,          // 是否已发送验证码
    smsCountdown: 0,         // 验证码倒计时
    smsError: '',            // SMS 错误信息
    smsTimer: null,
  },

  onShow() {
    this.loadBindStatus();
  },

  onUnload() {
    this.stopPolling();
    this.stopSmsCountdown();
  },

  /**
   * 加载绑定状态
   */
  async loadBindStatus() {
    try {
      const result = await app.callApi('authBindings');
      const bindings = result.bindings || [];

      const platforms = this.data.platforms.map(p => {
        const binding = bindings.find(b => b.platform === p.key);
        const status = binding?.status || 'not_bind';
        const statusTexts = {
          active: '已绑定 ✓',
          expired: '已过期，请重新绑定',
          revoked: '已解绑',
          not_bind: '未绑定',
        };
        return {
          ...p,
          status,
          statusText: statusTexts[status] || '未绑定',
          bindAt: binding?.bind_at || null,
        };
      });

      this.setData({ platforms });
    } catch (err) {
      console.error('Failed to load bind status:', err);
    }
  },

  /**
   * 点击平台进行绑定
   */
  onPlatformTap(e) {
    const platform = e.currentTarget.dataset.platform;
    const plat = this.data.platforms.find(p => p.key === platform);

    if (plat.status === 'active') {
      // 已绑定 → 确认解绑
      wx.showModal({
        title: '解绑确认',
        content: `确定解绑 ${plat.name} 吗？解绑后将不再同步该平台订单。`,
        success: async (res) => {
          if (res.confirm) {
            await this.unbind(platform);
          }
        },
      });
      return;
    }

    // 未绑定或已过期 → 发起绑定
    this.setData({
      loginMode: 'qr',     // 默认 QR 模式
      phone: '',
      smsCode: '',
      smsSent: false,
      smsError: '',
    });
    this.startBind(platform);
  },

  /* ────── QR 扫码登录 ────── */

  /**
   * 发起绑定流程（QR 扫码方式）
   */
  async startBind(platform) {
    const names = { pdd: '拼多多', jd: '京东', taobao: '淘宝' };
    this.setData({
      showQR: true,
      currentPlatform: platform,
      platformName: names[platform] || platform,
      loginStatus: 'pending',
      qrBase64: '',
    });

    try {
      const result = await app.callApi('authBind', { platform });
      this.setData({ qrBase64: `data:image/png;base64,${result.qrBase64}` });

      // 开始轮询扫码状态
      this.startPolling(result.sessionId, platform);
    } catch (err) {
      wx.showToast({ title: '绑定失败：' + err.message, icon: 'none' });
      this.setData({ showQR: false });
    }
  },

  /**
   * 轮询扫码状态
   */
  startPolling(sessionId, platform) {
    this.stopPolling();

    const timer = setInterval(async () => {
      try {
        const result = await app.callApi('authStatus', { session_id: sessionId });

        if (result.status === 'success') {
          this.setData({ loginStatus: 'success' });
          this.stopPolling();
          wx.showToast({ title: '绑定成功！', icon: 'success' });

          setTimeout(() => {
            this.setData({ showQR: false });
            this.loadBindStatus();
            app.refreshAll();
          }, 1500);
        } else if (result.status === 'expired') {
          this.setData({ loginStatus: 'expired' });
          this.stopPolling();
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000);

    this.data.pollingTimer = timer;
  },

  /**
   * 停止轮询
   */
  stopPolling() {
    if (this.data.pollingTimer) {
      clearInterval(this.data.pollingTimer);
      this.data.pollingTimer = null;
    }
  },

  /**
   * 关闭弹窗
   */
  closeQR() {
    this.stopPolling();
    this.stopSmsCountdown();
    this.setData({ showQR: false });
  },

  /**
   * 重试绑定（QR）
   */
  retryBind() {
    this.startBind(this.data.currentPlatform);
  },

  /* ────── SMS 验证码登录 ────── */

  /**
   * 切换到 SMS 登录模式（仅 PDD）
   */
  switchToSms() {
    this.stopPolling();
    this.setData({
      loginMode: 'sms',
      qrBase64: '',
      phone: '',
      smsCode: '',
      smsSent: false,
      smsError: '',
    });
  },

  /**
   * 切换回 QR 扫码模式
   */
  switchToQr() {
    this.setData({ loginMode: 'qr' });
    this.startBind(this.data.currentPlatform);
  },

  /**
   * 手机号输入
   */
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  /**
   * 验证码输入
   */
  onSmsCodeInput(e) {
    this.setData({ smsCode: e.detail.value });
  },

  /**
   * 发送短信验证码
   */
  async sendSms() {
    const phone = this.data.phone;
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    this.setData({ smsError: '' });

    try {
      const result = await app.callApi('authBind', {
        platform: 'pdd',
        method: 'sms',
        phone,
      });

      if (result.success && result.sessionId) {
        this.setData({
          smsSent: true,
          smsSessionId: result.sessionId,
          smsError: '',
        });
        this.startSmsCountdown();
        wx.showToast({ title: '验证码已发送', icon: 'success' });
      } else {
        this.setData({ smsError: result.error || '发送验证码失败' });
      }
    } catch (err) {
      this.setData({ smsError: err.message || '发送验证码失败' });
    }
  },

  /**
   * 验证短信验证码
   */
  async verifySms() {
    if (!this.data.smsCode || this.data.smsCode.length < 4) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return;
    }

    this.setData({ smsError: '' });

    try {
      const result = await app.callApi('authSmsVerify', {
        session_id: this.data.smsSessionId,
        code: this.data.smsCode,
      });

      if (result.status === 'success') {
        this.setData({ loginStatus: 'success' });
        wx.showToast({ title: '绑定成功！', icon: 'success' });
        setTimeout(() => {
          this.setData({ showQR: false });
          this.loadBindStatus();
          app.refreshAll();
        }, 1500);
      } else {
        this.setData({ smsError: result.error || '验证失败，请重试' });
      }
    } catch (err) {
      this.setData({ smsError: err.message || '验证失败' });
    }
  },

  /**
   * 验证码倒计时
   */
  startSmsCountdown() {
    this.stopSmsCountdown();
    this.setData({ smsCountdown: 60 });
    const timer = setInterval(() => {
      if (this.data.smsCountdown <= 1) {
        this.stopSmsCountdown();
        return;
      }
      this.setData({ smsCountdown: this.data.smsCountdown - 1 });
    }, 1000);
    this.data.smsTimer = timer;
  },

  stopSmsCountdown() {
    if (this.data.smsTimer) {
      clearInterval(this.data.smsTimer);
      this.data.smsTimer = null;
    }
  },

  /* ────── 解绑 ────── */

  /**
   * 解绑
   */
  async unbind(platform) {
    try {
      await app.callApi('authUnbind', { platform });
      wx.showToast({ title: '已解绑', icon: 'success' });
      this.loadBindStatus();
      app.refreshAll();
    } catch (err) {
      wx.showToast({ title: '解绑失败', icon: 'none' });
    }
  },
});

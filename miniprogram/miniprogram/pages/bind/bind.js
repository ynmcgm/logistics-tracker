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
  },

  onShow() {
    this.loadBindStatus();
  },

  onUnload() {
    this.stopPolling();
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
    this.startBind(platform);
  },

  /**
   * 发起绑定流程
   */
  async startBind(platform) {
    this.setData({
      showQR: true,
      currentPlatform: platform,
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

          // 延迟关闭二维码弹窗并刷新状态
          setTimeout(() => {
            this.setData({ showQR: false });
            this.loadBindStatus();
            app.refreshAll();
          }, 1500);
        } else if (result.status === 'expired') {
          this.setData({ loginStatus: 'expired' });
          this.stopPolling();
        }
        // pending → 继续轮询
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000); // 每 2 秒轮询一次

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
   * 关闭二维码弹窗
   */
  closeQR() {
    this.stopPolling();
    this.setData({ showQR: false });
  },

  /**
   * 重试绑定
   */
  retryBind() {
    this.startBind(this.data.currentPlatform);
  },

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

/**
 * 物流自动跟踪助手 - 小程序入口
 */
App({
  globalData: {
    user: null,
    bindings: {},
    settings: {},
  },

  onLaunch() {
    // 获取云开发环境
    wx.cloud.init({
      env: 'logistics-tracker-dev',  // 替换为实际的云开发环境 ID
      traceUser: true,
    });

    // 初始化时拉取用户数据和绑定状态
    this.refreshAll();
  },

  /**
   * 刷新所有数据
   */
  async refreshAll() {
    try {
      const [bindings, settings] = await Promise.all([
        this.callApi('authBindings'),
        this.callApi('getSettings'),
      ]);

      if (bindings) this.globalData.bindings = bindings.bindings || {};
      if (settings) this.globalData.settings = settings;
    } catch (err) {
      console.error('[App] Refresh failed:', err);
    }
  },

  /**
   * 调用云函数 API
   */
  callApi(action, data = {}) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'api-gateway',
        data: { action, data },
        success: res => {
          if (res.result && res.result.code === 0) {
            resolve(res.result.data);
          } else {
            console.error(`[API] ${action} failed:`, res.result?.error);
            reject(new Error(res.result?.error || 'API Error'));
          }
        },
        fail: err => {
          console.error(`[API] ${action} network error:`, err);
          reject(err);
        },
      });
    });
  },
});

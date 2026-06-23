/**
 * 设置页
 */
const app = getApp();

Page({
  data: {
    settings: {
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
      notify_on_arrival: true,
      notify_on_signed: true,
      notify_on_abnormal: true,
      max_daily_notifications: 20,
      subscribe_arrived: '未授权',
      subscribe_signed: '未授权',
    },
  },

  onShow() {
    this.loadSettings();
  },

  async loadSettings() {
    try {
      const result = await app.callApi('getSettings');
      this.setData({ settings: { ...this.data.settings, ...result } });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  async onSettingChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;

    const settings = { ...this.data.settings, [key]: value };

    try {
      await app.callApi('updateSettings', settings);
      this.setData({ settings });
    } catch {
      wx.showToast({ title: '设置失败', icon: 'none' });
      // 回滚
      this.loadSettings();
    }
  },

  async onTimeChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;

    const settings = { ...this.data.settings, [key]: value };

    try {
      await app.callApi('updateSettings', settings);
      this.setData({ settings });
    } catch {
      wx.showToast({ title: '设置失败', icon: 'none' });
    }
  },

  clearAllData() {
    wx.showModal({
      title: '确认清除',
      content: '将清除所有包裹数据和账号绑定，此操作不可恢复！',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '清除中...' });

          try {
            // 解绑所有平台
            const bindings = await app.callApi('authBindings');
            for (const b of bindings.bindings || []) {
              if (b.status === 'active') {
                await app.callApi('authUnbind', { platform: b.platform });
              }
            }

            // 删除所有包裹（通过递归调用）
            await deleteAllParcels();

            wx.hideLoading();
            wx.showToast({ title: '已清除所有数据', icon: 'success' });
            app.refreshAll();
          } catch {
            wx.hideLoading();
            wx.showToast({ title: '清除失败', icon: 'none' });
          }
        }
      },
    });
  },
});

/**
 * 删除用户所有包裹
 */
async function deleteAllParcels() {
  const result = await app.callApi('getParcels', { page: 1, pageSize: 100 });
  const parcels = result.parcels || [];

  for (const p of parcels) {
    await app.callApi('deleteParcel', { parcel_id: p.id });
  }
}

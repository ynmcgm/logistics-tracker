/**
 * 统计页
 */
const app = getApp();

Page({
  data: {
    stats: null,
    loading: true,
    months: [],
    selectedMonth: '',
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    this.setData({ loading: true });

    try {
      const result = await app.callApi('getStats');
      this.setData({ stats: result, loading: false });
    } catch (err) {
      wx.showToast({ title: '加载统计失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 计算百分比
   */
  calcPercent(value, total) {
    if (!total) return 0;
    return Math.round((value / total) * 100);
  },

  /**
   * 生成月度列表
   */
  generateMonths() {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      });
    }
    return months;
  },
});

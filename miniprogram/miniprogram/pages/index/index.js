/**
 * 首页 - 包裹列表
 */
const app = getApp();

Page({
  data: {
    parcels: [],
    currentTab: 'all',
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    showBindGuide: false,
  },

  onLoad() {
    this.loadParcels(true);
  },

  onShow() {
    // 每次显示时检查是否需要刷新
    if (this.data.parcels.length > 0) {
      this.loadParcels(true);
    }
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true, page: 1, hasMore: true });
    this.loadParcels(true).finally(() => {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadParcels();
    }
  },

  /**
   * 加载包裹列表
   */
  async loadParcels(isRefresh = false) {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      const page = isRefresh ? 1 : this.data.page;
      const status = this.data.currentTab === 'all' ? '' : this.data.currentTab;

      const result = await app.callApi('getParcels', {
        status,
        page,
        pageSize: 20,
      });

      const parcels = (result.parcels || []).map(p => ({
        ...p,
        statusText: this.getStatusText(p.status),
        statusClass: this.getStatusClass(p.status),
        timeText: this.formatTime(p.updated_at),
        trackingMasked: this.maskTracking(p.tracking_number),
      }));

      this.setData({
        parcels: isRefresh ? parcels : [...this.data.parcels, ...parcels],
        page: page + 1,
        hasMore: parcels.length >= 20,
        loading: false,
      });

      // 检查是否没有任何绑定
      this.checkBindStatus();
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /**
   * 检查绑定状态，显示引导
   */
  async checkBindStatus() {
    try {
      const bindings = await app.callApi('authBindings');
      const hasBind = (bindings.bindings || []).some(b => b.status === 'active');

      this.setData({
        showBindGuide: !hasBind && this.data.parcels.length === 0,
      });
    } catch {
      // ignore
    }
  },

  /**
   * 切换 Tab
   */
  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, page: 1, hasMore: true });
    this.loadParcels(true);
  },

  /**
   * 点击包裹
   */
  onParcelTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /**
   * 跳转绑定页
   */
  goToBind() {
    wx.switchTab({ url: '/pages/bind/bind' });
  },

  // ===== 工具方法 =====
  getStatusText(status) {
    const m = { pending: '待跟踪', transit: '运输中', arrived: '已到达',
                signed: '已签收', abnormal: '异常', archived: '已完成' };
    return m[status] || status;
  },

  getStatusClass(status) {
    const m = { transit: 'status-transit', arrived: 'status-arrived',
                signed: 'status-signed', abnormal: 'status-abnormal' };
    return m[status] || '';
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  maskTracking(num) {
    if (!num) return '';
    if (num.length <= 8) return num.slice(0,4) + '****';
    return num.slice(0,4) + '****' + num.slice(-4);
  },
});

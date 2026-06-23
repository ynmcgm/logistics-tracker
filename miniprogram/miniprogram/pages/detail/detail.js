/**
 * 包裹详情页
 */
const app = getApp();

Page({
  data: {
    parcel: null,
    records: [],
    loading: true,
  },

  onLoad(options) {
    const id = options.id;
    if (id) {
      this.loadDetail(id);
    }
  },

  async loadDetail(id) {
    this.setData({ loading: true });

    try {
      const result = await app.callApi('getParcelDetail', { parcel_id: id });

      const parcel = {
        ...result,
        statusText: this.getStatusText(result.status),
        statusClass: this.getStatusClass(result.status),
        trackingMasked: this.maskTracking(result.tracking_number),
        orderTime: this.formatDate(result.order_time),
        arrivalTime: result.arrived_at ? this.formatTime(result.arrived_at) : '',
        signedTime: result.signed_at ? this.formatTime(result.signed_at) : '',
      };

      const records = (result.tracking_records || []).map(r => ({
        ...r,
        timeText: this.formatTime(r.time),
        isKey: r.is_key_event,
      }));

      this.setData({ parcel, records, loading: false });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 切换静音状态
   */
  async toggleMute() {
    const parcel = this.data.parcel;
    const newMuted = !parcel.muted;

    try {
      await app.callApi('toggleMute', { parcel_id: parcel.id, muted: newMuted });
      this.setData({ 'parcel.muted': newMuted });
      wx.showToast({ title: newMuted ? '已静音' : '已取消静音', icon: 'success' });
    } catch {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  /**
   * 删除包裹
   */
  async deleteParcel() {
    wx.showModal({
      title: '确认删除',
      content: '删除后数据不可恢复',
      success: async (res) => {
        if (res.confirm) {
          try {
            await app.callApi('deleteParcel', { parcel_id: this.data.parcel.id });
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 1500);
          } catch {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      },
    });
  },

  /**
   * 复制运单号
   */
  copyTracking() {
    wx.setClipboardData({
      data: this.data.parcel.tracking_number,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
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

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  maskTracking(num) {
    if (!num) return '';
    if (num.length <= 8) return num.slice(0,4) + '****';
    return num.slice(0,4) + '****' + num.slice(-4);
  },
});

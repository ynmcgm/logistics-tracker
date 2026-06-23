/**
 * API 调用工具
 */

const app = getApp();

/**
 * 调用云函数 API
 */
export function callApi(action, data = {}) {
  return app.callApi(action, data);
}

/**
 * 格式化时间
 */
export function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${mins}`;
}

/**
 * 格式化日期
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 状态显示文本
 */
export function getStatusText(status) {
  const map = {
    pending: '待跟踪',
    transit: '运输中',
    arrived: '已到达',
    signed: '已签收',
    abnormal: '异常',
    archived: '已完成',
  };
  return map[status] || status;
}

/**
 * 状态 CSS class
 */
export function getStatusClass(status) {
  const map = {
    transit: 'status-transit',
    arrived: 'status-arrived',
    signed: 'status-signed',
    abnormal: 'status-abnormal',
  };
  return map[status] || '';
}

/**
 * 显示 toast 消息
 */
export function showToast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 2000 });
}

/**
 * 显示加载中
 */
export function showLoading(title = '加载中...') {
  wx.showLoading({ title });
}

/**
 * 隐藏加载
 */
export function hideLoading() {
  wx.hideLoading();
}

/**
 * 确认对话框
 */
export function showConfirm(title, content) {
  return new Promise((resolve, reject) => {
    wx.showModal({
      title,
      content,
      success: res => {
        if (res.confirm) resolve(true);
        else resolve(false);
      },
      fail: reject,
    });
  });
}

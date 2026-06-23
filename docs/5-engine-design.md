# 5. Playwright 自动化引擎设计

## 5.1 概述

Playwright 引擎运行在 CloudBase 云托管（Docker）环境中，
负责自动登录电商平台、抓取订单数据、提取运单号。

**架构模式**：平台适配器（Platform Adapter）

```
┌─────────────────────────────────────────┐
│              Engine Scheduler              │
│  (定时触发 / HTTP API 触发)                 │
└────────┬────────┬────────┬────────────────┘
         │        │        │
    ┌────┴──┐ ┌──┴────┐ ┌─┴──────┐
    │  PDD   │ │  JD    │ │ TaoBao  │
    │ Engine │ │ Engine │ │ Engine  │
    └───┬────┘ └───┬────┘ └───┬─────┘
        │          │          │
    ┌───┴──────────┴──────────┴──────┐
    │          Common Layer           │
    │  Browser  │ QR Login │ Session  │
    │  Pool     │ Handler  │ Manager  │
    └───────────┴──────────┴──────────┘
```

## 5.2 公共模块 (engines/common/)

### 5.2.1 Browser Pool (`browser.js`)

```javascript
// 设计要点
class BrowserPool {
  // 单例模式，全局只维护一个 Chromium 实例
  // 所有引擎共享同一个浏览器上下文
  // 关键配置:
  //   - headless: true (CloudBase 无可视化环境)
  //   - args: ['--no-sandbox', '--disable-setuid-sandbox']
  //   - 复用浏览器实例，减少冷启动
  
  async getBrowser()        // 获取浏览器实例
  async getContext(userId)  // 为指定用户获取隔离的 BrowserContext
  async closeAll()          // 关闭所有浏览器
}
```

### 5.2.2 QR 登录控制器 (`qr-login.js`)

```javascript
class QRLoginController {
  // 职责:
  //   1. 打开平台登录页
  //   2. 等待 QR 码元素出现并截图
  //   3. 返回 base64 给小程序显示
  //   4. 轮询等待用户扫码（检测页面跳转或特定元素出现）
  //   5. 超时（300秒）后自动取消
  //
  // 超时处理:
  //   - 300秒内未扫码 → timeout → 通知小程序"二维码已过期，请重试"
  //   - 扫码但登录失败 → 检测到错误提示 → 通知小程序"登录失败"
  //   - 扫码成功 → 检测到页面跳转到"我的订单" → 通知小程序"登录成功"
  
  async generateQR(platform, context)  // 打开登录页，捕获二维码
  async waitForScan(page, timeout)     // 等待用户扫码
  async extractSession(page)          // 扫码后提取登录态 cookie
}
```

**QR 码等待策略：**

```
等待用户扫码 → 轮询检测以下信号:
  
  ✅ 成功信号:
    1. URL 跳转到订单页 / 用户主页
    2. 出现用户头像/昵称元素
    3. Cookie 中包含登录态字段
  
  ❌ 失败信号:
    1. 页面出现"二维码已过期"提示
    2. 出现"登录异常"提示
    3. 超时 300 秒
  
  轮询间隔: 1 秒
```

### 5.2.3 Session 管理器 (`session.js`)

```javascript
class SessionManager {
  // 职责:
  //   1. 序列化 BrowserContext 的 cookie → 加密字符串
  //   2. 从加密字符串反序列化 → 恢复登录态
  //   3. 验证 cookie 是否仍然有效（发送一个鉴权请求）
  //
  // cookie 存储:
  //   - 加密存储到云数据库 sessions 集合
  //   - AES-256-CBC 加密，密钥来自环境变量
  //   - 存储时附带 user_agent 和 platform 信息
  //
  // cookie 验证:
  //   - 打开平台个人中心页面
  //   - 检查是否能加载到用户信息
  //   - 连续失败 3 次 → 标记为 expired
  
  async save(browserContext, userId, platform)
  async load(userId, platform)
  async validate(cookies, platform)
  async isExpired(sessionRecord)
}
```

### 5.2.4 反检测配置 (`stealth.js`)

```javascript
// 使用 playwright-extra + puppeteer-extra-plugin-stealth
// 关键配置:
//   - 禁用 WebDriver 特征
//   - 模拟真实 Chrome 版本号
//   - 模拟真实 User-Agent
//   - 注入缺失的 Chrome 运行时对象
//   - 设置 WebGL 厂商
//   - 设置屏幕分辨率（1920x1080）
//   - 设置时区为 Asia/Shanghai
//   - 设置语言为 zh-CN
//   - 随机化鼠标移动轨迹
//   - 随机化滚动行为
//
// 针对淘宝的特殊配置:
//   - 移除 navigator.webdriver
//   - 覆盖 chrome.runtime 检测
//   - 覆盖 permissions 检测

function getStealthConfig(platform) {
  return {
    // 基础配置
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    
    // platform-specific 配置
    ...platformConfigs[platform]
  }
}
```

## 5.3 拼多多引擎 (engines/pdd/)

### 5.3.1 入口 (`index.js`)

```javascript
class PDDEngine {
  // 实现 EngineBase 接口
  
  async login(userId)          // QR 扫码登录拼多多
  async syncOrders(userId)     // 同步近 3 个月订单
  async validate(session)      // 验证 session 是否有效
  
  // 内部方法
  async navigateToOrders(page) // 导航到"我的订单"页面
  async scrapeOrders(page)     // 抓取所有订单
  async parseOrder(element)    // 解析单个订单卡片
  async extractTracking(page)  // 从物流详情提取运单号
}
```

### 5.3.2 登录流程 (`login.js`)

```
1. 打开 https://mobile.yangkeduo.com/login.html
2. 等待二维码元素出现 (img.qrcode-img 或者类似选择器)
3. 截图二维码 → 返回 base64
4. 轮询检测扫码结果:
   a. 每 1 秒检查一次页面 URL
   b. 如果 URL 跳转到 https://mobile.yangkeduo.com/ 或其他非登录页
      → 登录成功
   c. 如果页面出现"二维码已过期" → 返回 timeout
5. 提取 cookie → 加密存储
```

**选择器注意事项**：拼多多移动端前端组件名可能带有 hash 后缀（如 `_v_1a2b3`），
建议使用文本内容或 data-* 属性定位，而不是 class 名。

### 5.3.3 订单抓取 (`orders.js`)

```
1. 从 SessionManager 加载 cookie → 恢复登录态
2. 打开 https://mobile.yangkeduo.com/my_order.html
3. 等待订单列表加载完成
4. 滚动加载更多（拼多多订单列表是懒加载）
5. 解析每个订单卡片的:
   - 商品名称 (选择器: .order-item .goods-title 或商品名元素)
   - 订单状态（待发货/已发货/已完成/已取消）
   - 订单编号
6. 对于"已发货"订单 → 点击"查看物流" → 在新区域提取运单号
7. 返回所有未签收订单的运单信息
```

**注意事项：**
- 拼多多移动端页面结构可能变化，需要用稳健的选择器
- 建议使用 `page.locator()` 配合文本匹配
- 点击查看物流时可能打开新页面或弹窗，需分别处理
- 捕获所有异常并截图保存

### 5.3.4 数据解析 (`parser.js`)

```javascript
// 解析逻辑
function parseOrderId(text) {
  // 拼多多订单号格式: 纯数字 18-20 位
  return text.match(/\b(\d{18,20})\b/)?.[1]
}

function parseTrackingNumber(text) {
  // 运单号格式:
  //   中通/圆通/韵达/申通/极兔: 纯数字 12-15 位
  //   顺丰: SF + 数字 (12位)
  //   EMS: 数字 + 字母混合 (13位)
  const patterns = [
    /(?:运单号|快递单号|物流单号)[：:\s]*([A-Za-z0-9]{10,20})/,
    /\b(SF\d{10,12})\b/i,
    /\b(\d{12,15})\b/
  ]
  // 依次匹配
}

function detectCourier(trackingNumber) {
  // 根据运单号前缀判断快递公司
  if (/^SF/i.test(tn)) return '顺丰速运'
  if (/^JD/i.test(tn)) return '京东快递'
  if (/^YT/i.test(tn)) return '圆通速递'
  if (/^\d{12}$/.test(tn)) return '中通快递' // 依情况而定
  // ... 更精确的匹配表
}
```

## 5.4 Session 持久化与恢复

### 5.4.1 保存 Session

```javascript
async function saveSession(browserContext, userId, platform) {
  // 1. 从 BrowserContext 获取全部 cookie
  const cookies = await browserContext.cookies()
  
  // 2. 过滤出与平台相关的 cookie（按 domain）
  const platformCookies = cookies.filter(c => 
    c.domain.includes('yangkeduo.com') || 
    c.domain.includes('pinduoduo.com')
  )
  
  // 3. 序列化为 JSON
  const cookieStr = JSON.stringify(platformCookies)
  
  // 4. AES-256 加密
  const encrypted = encrypt(cookieStr, ENCRYPTION_KEY)
  
  // 5. 存入云数据库
  await db.collection('sessions').updateOne(
    { user_openid: userId, platform },
    { $set: { cookies_encrypted: encrypted, status: 'active', last_verified: new Date() } },
    { upsert: true }
  )
}
```

### 5.4.2 恢复 Session

```javascript
async function restoreSession(userId, platform) {
  // 1. 从云数据库读取加密后的 cookie
  const record = await db.collection('sessions').findOne({
    user_openid: userId, platform, status: 'active'
  })
  
  if (!record) return null
  
  // 2. 解密
  const cookieStr = decrypt(record.cookies_encrypted, ENCRYPTION_KEY)
  const cookies = JSON.parse(cookieStr)
  
  // 3. 创建隔离的 BrowserContext
  const context = await browser.newContext()
  await context.addCookies(cookies)
  
  return context
}
```

### 5.4.3 Session 验证

```javascript
async function validateSession(context, platform) {
  try {
    const page = await context.newPage()
    await page.goto('https://mobile.yangkeduo.com/', { waitUntil: 'networkidle' })
    
    // 判断是否已登录: 检查页面上是否有用户相关元素
    const isLoggedIn = await page.locator('.user-avatar, .user-name').isVisible()
    await page.close()
    return isLoggedIn
  } catch {
    return false
  }
}
```

## 5.5 Docker 配置

### Dockerfile

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    chromium-browser \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node 依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制代码
COPY . .

# 非 root 用户运行
USER pwuser

EXPOSE 3000
CMD ["node", "server.js"]
```

### 环境变量

```
ENCRYPTION_KEY=         # AES-256 加密密钥
CLOUDBASE_ENV_ID=       # CloudBase 环境 ID
KUAIDI100_KEY=          # 快递100 API Key
KUAIDI100_CUSTOMER=     # 快递100 Customer ID
PLATFORMS_ENABLED=pdd   # 启用的平台
SYNC_INTERVAL_HOURS=8   # 订单同步间隔
LOG_LEVEL=info          # 日志级别
```

## 5.6 错误处理与重试

| 错误场景 | 处理 | 重试策略 |
|---|---|---|
| 浏览器启动失败 | 重启 Docker 容器 | 3 次，间隔 10s |
| 页面加载超时 (30s) | 截图 + 日志 | 2 次，间隔 5s |
| Session 无效 | 标记 expired，通知用户 | 不再重试 |
| 元素未找到 | 截图 + 记录 DOM 快照 | 2 次，更换选择器 |
| 平台风控/验证码 | 停止本次操作，下次周期再试 | 1 小时后重试 |
| 网络错误 | 等待后重试 | 3 次指数退避 |

## 5.7 日志

所有引擎操作记录结构化日志：

```javascript
logger.info({
  event: 'sync_orders',
  platform: 'pdd',
  user: userId,
  result: 'success',
  orders_found: 15,
  new_parcels: 3,
  duration_ms: 45200
})
```

引擎运行产生的截图存储在 CloudBase 云存储中，保留 7 天。

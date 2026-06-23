# 物流自动跟踪助手

微信小程序 —— 自动跟踪拼多多、京东、淘宝的物流信息，
**一旦到达目的地城市或已签收，自动发送微信订阅消息通知。**

## 核心特性

- 🔄 **全自动**：仅需一次扫码授权，自动同步订单和物流
- 🤫 **不打扰**：只推送「到城市」「已签收」「异常滞留」三个关键节点
- ⏰ **免打扰时段**：22:00-08:00 延迟推送
- 📦 **多平台**：拼多多 → 京东 → 淘宝 逐步接入
- 📊 **数据统计**：月度收件统计、包裹趋势分析
- 🐳 **Docker 容器化**：Playwright 自动化引擎运行在 CloudBase 云托管

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  微信小程序 (Mini Program)                       │
│  ┌─────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌──────┐                │
│  │首页  │ │包裹列表│ │设置  │ │数据统计│ │我的  │                │
│  └──┬──┘ └──┬───┘ └──┬───┘ └───┬────┘ └──┬───┘                │
│     │       │        │         │         │                      │
│     └───────┴────────┴─────────┴─────────┘                      │
│                        │ wx.cloud.callFunction                   │
└────────────────────────┼────────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────┼────────────────────────────────────────┐
│              CloudBase (腾讯云开发)                              │
│  ┌─────────────────────┼─────────────────────────────────────┐  │
│  │        API 网关 (api-gateway)                             │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │账号绑定  │ │ 包裹管理  │ │ 数据统计  │ │  设置       │ │  │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ │  │
│  └───────┼───────────┼────────────┼──────────────┼─────────┘  │
│          │           │            │              │            │
│  ┌───────┴┐  ┌───────┴──────┐ ┌──┴─────────┐ ┌─┴──────────┐  │
│  │engine- │  │tracking-    │ │notification│ │ CloudBase  │  │
│  │controller    │worker      │ │-sender     │ │ Database    │  │
│  │(定时同步)│  │(每2小时跟踪)│ │(每分钟推送)│ │ (MongoDB)  │  │
│  └────┬───┘  └─────────────┘ └────────────┘ └────────────┘  │
│       │                                                       │
│  ┌────┴─────────────────────────────────────────────────────┐ │
│  │  CloudRun: logistics-engine (Docker + Playwright)        │ │
│  │  ┌──────────┐ ┌──────────────┐ ┌────────────────────┐   │ │
│  │  │ QR 登录   │ │ 订单解析     │ │ DB 适配器          │   │ │
│  │  └──────────┘ └──────────────┘ └────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  快递100 API (api.kuaidi100.com)                          │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

## 部署状态

| 组件 | 状态 | 备注 |
|---|---|---|
| 拼多多引擎 | ✅ **已部署运行** | Playwright 自动化，支持 QR 扫码登录、订单同步、状态轮询 |
| 京东/淘宝引擎 | ⏸️ 待开始 | PDD 稳定后再扩展 |
| 小程序前端 | ✅ 代码完成 | 5 个页面，完整功能 |
| api-gateway | ✅ **已部署** | 统一 API 入口，含登录态轮询、引擎调用 |
| tracking-worker | ✅ **已部署** | 每 2 小时查询快递100 API |
| engine-controller | ✅ **已部署** | 定时触发引擎同步订单 |
| notification-sender | ✅ **已部署** | 每 1 分钟处理通知队列 |
| CloudRun (Docker) | ✅ **已部署运行** | logistics-engine (端口 3000, 公网访问已启用) |
| CloudBase 套餐 | ✅ **已升级个人版** | 有效期至 2026-12-23 |
| 微信订阅消息模板 | ⏸️ 待申请 | 需登录微信公众平台创建模板 ID |
| 小程序备案/认证 | ⏸️ 上线前完成 | 目前可用开发者工具预览 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 微信小程序原生框架 |
| 后端 | 微信云开发 (CloudBase)：4 个云函数 + 云托管 (Docker) |
| 自动化引擎 | Playwright v1.52 + playwright-extra (stealth 插件) |
| 运行环境 | Docker (mcr.microsoft.com/playwright:v1.52.0-jammy) |
| 物流查询 | 快递100 免费 API (api.kuaidi100.com) |
| 消息推送 | 微信订阅消息 |
| 数据库 | CloudBase 文档数据库 (MongoDB-like) |
| SDK | @cloudbase/node-sdk, wx-server-sdk |

## API 端点

### 引擎 (CloudRun)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查，返回注册的引擎列表 |
| POST | `/login` | 发起扫码登录，返回 `{ sessionId, qrBase64 }` |
| POST | `/loginStatus` | 轮询扫码状态，`{ platform, session_id, user_id }` |
| POST | `/sync` | 触发订单同步，`{ platform, user_id }` |
| POST | `/validate` | 验证 session 有效性，`{ platform, user_id }` |

### 云函数 (api-gateway)

| action | 说明 |
|--------|------|
| `authBind` | 发起平台绑定（扫码登录） |
| `authStatus` | 轮询绑定状态，引擎返回成功时自动保存 cookies |
| `authUnbind` | 解绑平台 |
| `authBindings` | 获取已绑定的平台列表 |
| `getParcels` | 获取包裹列表 |
| `getParcelDetail` | 获取包裹详情（含跟踪轨迹） |
| `toggleMute` | 静音/取消静音包裹 |
| `deleteParcel` | 删除包裹 |
| `getStats` | 数据统计 |
| `getSettings` | 获取用户设置 |
| `updateSettings` | 更新用户设置 |
| `triggerSync` | 手动触发订单同步 |

## 关键文件

```
logistics-tracker/
├── engines/                     # Playwright 自动化引擎
│   ├── common/
│   │   ├── browser.js          # 浏览器池管理 (单例 Chromium)
│   │   ├── session.js          # Cookie AES-256-CBC 加解密
│   │   ├── db-adapter.js       # CloudBase SDK 适配器 (MongoDB 风格接口)
│   │   ├── qr-login.js         # QR 码登录控制器 (超时5分钟)
│   │   ├── courier-db.js       # 快递公司识别数据库
│   │   ├── status-detector.js  # 物流状态智能分类
│   │   └── stealth.js          # 反检测配置
│   ├── pdd/
│   │   ├── index.js            # 引擎主类 (login/syncOrders/validate/unbind)
│   │   ├── login.js            # 拼多多 QR 扫码登录
│   │   ├── orders.js           # 订单列表抓取 + 解析
│   │   └── parser.js           # 订单号/运单号解析
│   ├── server.js               # HTTP 服务 (所有 API 路由)
│   ├── Dockerfile              # 容器构建 (Playwright + 中文字体)
│   └── package.json            # ES Module, Playwright + @cloudbase/node-sdk
├── miniprogram/                 # 微信小程序
│   ├── miniprogram/            # 前端 (5 页面 + tabBar)
│   └── cloudfunctions/         # 4 个云函数
│       ├── api-gateway/        # 统一 API 入口
│       ├── engine-controller/  # CloudRun 定时调度
│       ├── tracking-worker/    # 快递100 物流追踪
│       └── notification-sender/ # 订阅消息推送
├── tests/
│   ├── unit/                   # 单元测试 (73 个, node:test)
│   │   ├── session.test.js     # Cookie 加解密
│   │   ├── notification.test.js # 通知决策 + 免打扰时段
│   │   ├── parsers.test.js     # 订单号/运单号/快递公司/状态检测
│   │   └── db-adapter.test.js  # DB 适配器 (内存回退)
│   └── smoke/
│       └── engine-api.mjs      # 引擎 API 冒烟测试
├── cloudbaserc.json            # CloudBase 部署配置
└── .gitignore
```

## 测试

```bash
# 运行全部 73 个单元测试
npm test

# 引擎 API 冒烟测试（需引擎运行中）
node tests/smoke/engine-api.mjs
```

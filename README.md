# 物流自动跟踪助手

微信小程序 —— 自动跟踪拼多多、京东、淘宝的物流信息，
**一旦到达目的地城市或已签收，自动发送微信订阅消息通知。**

## 核心特性

- 🔄 **全自动**：仅需一次扫码授权，自动同步订单和物流
- 🤫 **不打扰**：只推送「到城市」「已签收」「异常滞留」三个关键节点
- ⏰ **免打扰时段**：22:00-08:00 延迟推送
- 📦 **多平台**：拼多多 → 京东 → 淘宝 逐步接入
- 📊 **数据统计**：月度收件统计、包裹趋势分析

## 项目结构

```
logistics-tracker/
├── docs/                    # 全套设计文档
│   ├── 1-requirements.md    # 需求规格说明书
│   ├── 2-architecture.md    # 系统架构设计
│   ├── 3-database-design.md # 数据库设计
│   ├── 4-api-design.md      # API 接口设计
│   ├── 5-engine-design.md   # Playwright 引擎设计
│   ├── 6-frontend-design.md # 前端设计
│   ├── 7-notification.md    # 通知推送设计
│   ├── 8-test-plan.md       # 测试计划
│   └── 9-deployment.md      # 部署方案
├── engines/                 # Playwright 自动化引擎（云托管）
│   ├── common/              # 公共模块
│   └── pdd/                 # 拼多多引擎（第一个平台）
├── miniprogram/             # 微信小程序
│   ├── miniprogram/         # 前端代码
│   └── cloudfunctions/      # 云函数
├── tests/                   # 测试
└── scripts/                 # 工具脚本
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 微信小程序原生框架 |
| 后端 | 微信云开发 (CloudBase) |
| 自动化引擎 | Playwright + Node.js |
| 运行环境 | CloudBase 云托管 (Docker) |
| 物流查询 | 快递100 免费 API |
| 消息推送 | 微信订阅消息 |

## 开发状态

- [ ] 拼多多引擎 —— 开发中
- [ ] 京东引擎 —— 待开始
- [ ] 淘宝引擎 —— 待开始
- [ ] 小程序前端 —— 开发中
- [ ] 云函数 —— 开发中

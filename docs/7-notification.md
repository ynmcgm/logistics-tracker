# 7. 通知推送设计

## 7.1 概述

微信通知通过「小程序订阅消息」实现。用户在第一次触发通知场景时授权，
后续对应场景可发送一条消息。

**关键限制**：
- 一次性订阅：每次推送前需用户点击授权（"总是保持以上选择，不再询问"可简化）
- 长期订阅：仅限政务/民生类目，本项目中不可用
- 模板需在微信小程序管理后台申请审核

## 7.2 消息模板

需要在小程序后台申请以下 2 个订阅消息模板：

### 模板 1：包裹到达通知

| 参数 | 类型 | 示例值 | 说明 |
|---|---|---|---|
| thing1 | 事物 | 中通快递 | 快递公司名称 |
| character_string2 | 数字 | 7730***789 | 运单号（脱敏显示） |
| thing3 | 事物 | 上海市 | 到达城市 |
| date4 | 时间 | 2026年06月23日 14:00 | 到达时间 |

### 模板 2：包裹签收通知

| 参数 | 类型 | 示例值 | 说明 |
|---|---|---|---|
| thing1 | 事物 | 智能运动手环 | 商品名称 |
| thing2 | 事物 | 中通快递 | 快递公司 |
| date3 | 时间 | 2026年06月23日 18:00 | 签收时间 |
| character_string4 | 数字 | 7730***789 | 运单号 |

## 7.3 推送决策引擎

```
┌─────────────────────────────────────────────┐
│             物流状态变更事件                      │
│  (来自 tracking-worker 云函数)                 │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│          推送决策引擎                            │
│                                               │
│  1. 该包裹是否被用户静音?                        │
│     ├── 是 → 跳过，记录日志                      │
│     └── 否 → 继续                              │
│                                               │
│  2. 该状态是否已推送过?                           │
│     (比较 last_notified_status)                │
│     ├── 相同 → 跳过（防重复）                    │
│     └── 不同 → 继续                             │
│                                               │
│  3. 是否是关键节点?                              │
│     ├── arrived_city → 继续                    │
│     ├── signed → 继续                           │
│     ├── abnormal → 继续                         │
│     └── 其他 → 跳过（静默节点）                   │
│                                               │
│  4. 用户是否开启了该类型的通知?                    │
│     ├── 关闭 → 跳过                             │
│     └── 开启 → 继续                             │
│                                               │
│         ▼                                      │
│   写入 notification_queue                       │
└─────────────────────────────────────────────┘
```

## 7.4 通知发送流程

```
┌─────────────────────────────────────────────┐
│    notification-sender 云函数                  │
│    (定时触发器，每1分钟运行一次)                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
  从 notification_queue 读取 pending 记录
  (按 scheduled_at 升序，每次10条)
                   │
                   ▼
  对每条记录:
  1. 检查当前时间是否 >= scheduled_at
  2. 检查用户当日推送频率未超限（默认 max=20/天）
                   │
                   ▼
  ┌─────────────────────────────────────────┐
  │  调用微信订阅消息 API                       │
  │  POST https://api.weixin.qq.com/cgi-bin/ │
  │  message/subscribe/send                  │
  │                                          │
  │  参数:                                    │
  │  {                                        │
  │    "touser": "OPENID",                   │
  │    "template_id": "TEMPLATE_ID",         │
  │    "page": "pages/detail/detail?id=xxx", │
  │    "data": { ... }                       │
  │  }                                        │
  └─────────────────────────────────────────┘
                   │
                   ▼
  处理结果:
  ├── 成功 (errcode: 0) → 标记 sent
  ├── 用户拒绝 (errcode: 43101) → 标记 cancelled
  │   (后续不再尝试推送给该用户)
  └── 频率超限 (errcode: 45008) → 标记 delayed
       (下个周期重试)
```

## 7.5 免打扰实现

```
用户设置:
  quiet_hours_enabled: true
  quiet_hours_start: "22:00"
  quiet_hours_end: "08:00"

判断逻辑 ── notification_queue 写入时:
  
  检查当前时间是否在 [22:00, 次日08:00) 范围内:
  ├── 是 → scheduled_at = 次日 08:01
  │        status = "delayed"
  │        delay_reason = "quiet_hours"
  │
  └── 否 → scheduled_at = now
           status = "pending"
           
notification-sender 消费时:
  只取 scheduled_at <= now() 的记录
  自然实现延迟发送
```

## 7.6 频率控制

| 限制 | 值 | 实现 |
|---|---|---|
| 同一包裹同一状态 | 24小时不重复 | `parcels.last_notified_status` 比对 |
| 每日每用户 | 20 条 (默认，可配置) | `notify_log` 按用户+日期计数 |
| 微信 API 限制 | 按模板每天 | 原生限制，记录日志 |
| 包裹静音 | 用户控制 | `parcels.muted` 标志位 |

## 7.7 用户授权管理

### 授权时机

```
时机1: 用户首次绑定平台后
  → "是否订阅物流通知?"
  → 用户选择"同意" → 保存 subscribe_ids
  
时机2: 用户主动在设置页点击授权
  → 调用 wx.requestSubscribeMessage
  → 选择具体模板

时机3: 发送通知时发现已取消授权
  → 静默标记为未授权
  → 在设置页显示"去授权"
```

### 授权状态维护

```javascript
// 用户订阅状态数据结构 (users 集合中)
{
  subscribe_templates: {
    arrived: {
      template_id: "TEMPLATE_ID_1",
      status: "authorized" | "unauthorized" | "never",
      authorized_at: "2026-06-20T10:00:00.000Z",
      expire_at: null  // 一次性订阅不自动过期
    },
    signed: {
      template_id: "TEMPLATE_ID_2",
      status: "unauthorized",
      authorized_at: null,
      expire_at: null
    }
  }
}
```

## 7.8 通知日志与监控

```javascript
// notify_log 集合记录每次发送
{
  user_openid: "xxx",
  template_id: "xxx",
  status_category: "arrived_city",
  result: "sent",          // sent | failed | user_deny
  error_msg: null,         // 微信API返回的错误描述
  sent_at: "2026-06-23T14:05:00.000Z"
}

// 用于监控的聚合查询
// 1. 每日推送成功率
// 2. 各模板使用量
// 3. 用户授权/取消趋势
// 4. 频率超限次数
```

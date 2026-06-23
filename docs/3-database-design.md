# 3. 数据库设计

## 3.1 概览

使用 CloudBase 云数据库（MongoDB 兼容），共 5 个集合。

```
集合                          说明
──────────────────────────────────────────────
users                         微信用户表
sessions                      第三方平台登录会话
parcels                       包裹主表
tracking_records              物流轨迹记录
notification_queue            通知队列
notify_log                    推送日志
```

## 3.2 集合设计

### 3.2.1 `users` — 微信用户

```javascript
{
  _id: "string",                   // CloudBase 自动生成
  openid: "string",                // 微信用户 openid（唯一索引）
  nickname: "string | null",       // 微信昵称
  avatar: "string | null",         // 头像 URL
  created_at: Date,                // 首次使用时间
  updated_at: Date,                // 最后操作时间

  // 设置
  settings: {
    quiet_hours_enabled: true,              // 免打扰开关
    quiet_hours_start: "22:00",             // 免打扰开始时间
    quiet_hours_end: "08:00",               // 免打扰结束时间
    notify_on_arrival: true,                // 到城市通知
    notify_on_signed: true,                 // 已签收通知
    notify_on_abnormal: true,               // 异常通知
    max_daily_notifications: 20             // 每日最大通知数
  }
}

// 索引
// { openid: 1 }  unique
```

### 3.2.2 `sessions` — 平台登录会话

```javascript
{
  _id: "string",
  user_openid: "string",            // 关联用户（索引）
  platform: "pdd" | "jd" | "taobao", // 平台标识
  status: "active" | "expired" | "revoked",  // 状态
  cookies_encrypted: "string",      // AES-256 加密后的 cookie
  user_agent: "string",             // 绑定时的 UA
  created_at: Date,                 // 首次绑定时间
  last_verified: Date,              // 最后验证 session 有效时间
  expires_at: Date | null,          // cookie 过期时间（如可知）
  revoked_at: Date | null,          // 解绑时间
  fail_count: 0,                    // 连续验证失败次数
  last_error: "string | null"       // 最后错误信息
}

// 索引
// { user_openid: 1, platform: 1 }  unique
// { status: 1 }
// { last_verified: 1 }  // 用于每日 session 检查
```

### 3.2.3 `parcels` — 包裹

```javascript
{
  _id: "string",
  user_openid: "string",             // 所属用户（索引）
  platform: "pdd" | "jd" | "taobao", // 来源平台
  order_id: "string",                // 平台订单号
  tracking_number: "string",         // 运单号（索引）
  courier: "string",                 // 快递公司名称
  courier_code: "string",            // 快递100 公司编码
  product_name: "string",            // 商品名称
  product_image: "string | null",    // 商品图片 URL

  // 状态
  status: "pending" | "transit" | "arrived" | "signed" | "abnormal" | "archived",

  // 物流跟踪
  subscribe_template_id: "string | null",  // 微信订阅消息模板 ID
  tracking_enabled: true,                  // 是否正在跟踪
  last_tracked_at: Date | null,            // 最后查询物流时间
  next_track_at: Date | null,              // 下次可查询时间（频率控制）
  track_fail_count: 0,                     // 连续查询失败次数

  // 目的地
  destination_city: "string",              // 目的地城市（用户所在城市）
  arrived_at: Date | null,                 // 到达城市时间
  signed_at: Date | null,                  // 签收时间

  // 通知控制
  muted: false,                            // 该包裹是否静音
  last_notified_status: "string | null",   // 最后推送过的状态，防重复

  // 时间
  order_time: Date | null,                 // 下单时间
  created_at: Date,                        // 首次导入时间
  updated_at: Date,                        // 最后更新时间
  archived_at: Date | null                 // 归档时间
}

// 索引
// { user_openid: 1, status: 1 }
// { tracking_number: 1 }  unique (sparse)
// { tracking_enabled: 1, next_track_at: 1 }  // 用于物流跟踪调度
// { user_openid: 1, created_at: -1 }  // 列表排序
```

### 3.2.4 `tracking_records` — 物流轨迹

```javascript
{
  _id: "string",
  parcel_id: "string",               // 关联包裹（索引）
  tracking_number: "string",          // 运单号（索引）

  // 轨迹节点
  context: "string",                  // 物流描述，如"快件已到达上海分拨中心"
  status_category:                    // 节点分类
    "collected" |                     // 已揽收
    "in_transit" |                    // 运输中
    "arrived_city" |                  // 到达目的地城市 ★ 关键节点
    "delivering" |                    // 派送中
    "signed" |                        // 已签收 ★ 关键节点
    "abnormal" |                      // 异常/滞留 ★ 关键节点
    "other",                          // 其他
  city: "string | null",              // 所在城市
  time: Date,                         // 物流时间
  recorded_at: Date,                  // 记录时间

  // 状态推导
  is_key_event: false,                // 是否为关键节点

  // 去重
  context_hash: "string"              // 描述内容的 hash，用于去重
}

// 索引
// { parcel_id: 1, context_hash: 1 }  unique  // 防止重复插入同一条轨迹
// { parcel_id: 1, time: -1 }  // 时间线排序
// { tracking_number: 1, time: -1 }
```

### 3.2.5 `notification_queue` — 通知队列

```javascript
{
  _id: "string",
  user_openid: "string",              // 目标用户（索引）
  parcel_id: "string",                // 关联包裹
  template_id: "string",              // 微信订阅消息模板 ID

  // 通知内容
  title: "string",                    // 消息标题
  data: {                             // 模板消息数据
    thing1: { value: "xxx" },
    thing2: { value: "xxx" },
    date3: { value: "xxx" },
    thing4: { value: "xxx" }
  },
  page: "string | null",             // 点击跳转的小程序页面

  // 状态
  status: "pending" | "delayed" | "sent" | "failed" | "cancelled",
  status_category: "arrived_city" | "signed" | "abnormal",
  delay_reason: "string | null",      // 延迟原因（quiet_hours / rate_limit）

  // 时间
  created_at: Date,                   // 入队时间
  scheduled_at: Date,                 // 计划发送时间
  sent_at: Date | null,               // 实际发送时间
  fail_reason: "string | null"        // 发送失败原因
}

// 索引
// { status: 1, scheduled_at: 1 }  // 消费者查询
// { user_openid: 1, status: 1 }
```

### 3.2.6 `notify_log` — 推送日志（归档）

```javascript
{
  _id: "string",
  user_openid: "string",
  parcel_id: "string",
  queue_id: "string",                  // 关联 notification_queue
  template_id: "string",

  status_category: "arrived_city" | "signed" | "abnormal",
  result: "sent" | "failed" | "user_deny",
  error_msg: "string | null",

  sent_at: Date,
  created_at: Date
}

// 索引
// { user_openid: 1, sent_at: -1 }
```

## 3.3 状态机

### 包裹状态

```
                    ┌─────────┐
        ┌──────────►│ pending │◄──────────┐
        │           └────┬────┘            │
        │                │ 首次查询到物流    │
        │                ▼                 │
        │           ┌─────────┐            │
        │           │ transit │            │
        │           └──┬──┬───┘            │
        │              │  │                │
        │    ┌─────────┘  └──────┐         │
        │    ▼                   ▼         │
        │ ┌────────┐      ┌──────────┐     │
        │ │arrived │      │ abnormal │     │
        │ └───┬────┘      └────┬─────┘     │
        │     │                │           │
        │     ▼                │           │
        │ ┌────────┐           │           │
        │ │ signed │◄──────────┘           │
        │ └───┬────┘                       │
        │     │ 7天后自动归档                │
        │     ▼                            │
        │ ┌──────────┐                     │
        └─│ archived │                     │
          └──────────┘                     │
```

## 3.4 关键查询模式

### 首页包裹列表
```javascript
db.collection("parcels")
  .where({
    user_openid: openid,
    status: _.nin(["archived"])  // 排除已归档
  })
  .orderBy("updated_at", "desc")
  .limit(50)
  .get()
```

### 物流跟踪调度（待查询的包裹）
```javascript
db.collection("parcels")
  .where({
    tracking_enabled: true,
    status: _.in(["transit", "arrived", "abnormal"]),
    next_track_at: _.lte(new Date())  // 到了可查询时间
  })
  .limit(50)
  .get()
```

### 通知队列消费者
```javascript
db.collection("notification_queue")
  .where({
    status: "pending",
    scheduled_at: _.lte(new Date())
  })
  .orderBy("scheduled_at", "asc")
  .limit(10)
  .get()
```

## 3.5 数据清理策略

| 集合 | 清理策略 | 周期 |
|---|---|---|
| tracking_records | 包裹归档后保留 30 天 | 每日凌晨清理 |
| notification_queue | 已发送/已取消的记录保留 7 天 | 每日凌晨清理 |
| notify_log | 保留 90 天 | 每日凌晨清理 |
| parcels | 用户主动删除 + 归档超 30 天可物理删除 | 手动/按需 |

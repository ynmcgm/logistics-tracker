# 4. API 接口设计

## 4.1 总则

- 所有 API 通过 CloudBase 云函数 `api-gateway` 暴露
- 使用 HTTPS + JSON
- 请求头携带 `X-WX-OPENID`（CloudBase 自动注入微信用户身份）
- 所有接口需鉴权，仅允许访问自身数据
- 时间字段统一使用 ISO 8601 格式

### 通用响应格式

```json
// 成功
{ "code": 0, "data": { ... } }

// 失败
{ "code": 1001, "error": "错误描述" }
```

### 错误码

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 未授权/登录过期 |
| 1003 | 资源不存在 |
| 1004 | 频率限制 |
| 1005 | 内部错误 |
| 2001 | Session 已过期，需重新扫码 |
| 2002 | 引擎执行超时 |
| 2003 | 快递100 API 错误 |

---

## 4.2 账号绑定接口

### POST /auth/bind

发起平台扫码绑定。

**Request**
```json
{
  "platform": "pdd"
}
```

**Response**
```json
{
  "code": 0,
  "data": {
    "session_id": "a1b2c3d4-...",
    "qr_base64": "data:image/png;base64,iVBOR...",
    "expires_in": 300
  }
}
```

### GET /auth/status

轮询扫码登录状态。

**Query**
```
?session_id=a1b2c3d4-...&platform=pdd
```

**Response**
```json
{
  "code": 0,
  "data": {
    "status": "pending" | "success" | "expired" | "failed",
    "platform": "pdd",
    "bind_at": "2026-06-23T15:30:00.000Z"  // success 时返回
  }
}
```

### POST /auth/unbind

解绑平台账号。

**Request**
```json
{
  "platform": "pdd"
}
```

**Response**
```json
{ "code": 0, "data": { "unbind_at": "..." } }
```

### GET /auth/bindings

查询当前用户所有平台的绑定状态。

**Response**
```json
{
  "code": 0,
  "data": {
    "bindings": [
      { "platform": "pdd", "status": "active", "bind_at": "..." },
      { "platform": "jd",  "status": "expired", "bind_at": "..." },
      { "platform": "taobao", "status": "not_bind", "bind_at": null }
    ]
  }
}
```

---

## 4.3 包裹接口

### GET /parcels

获取包裹列表。

**Query**
```
?status=transit,arrived,signed  // 按状态过滤
&page=1
&page_size=20
&sort=updated_at:desc
```

**Response**
```json
{
  "code": 0,
  "data": {
    "parcels": [
      {
        "id": "parcel_xxx",
        "platform": "pdd",
        "tracking_number": "7730123456789",
        "courier": "中通快递",
        "product_name": "智能手环",
        "product_image": "https://...",
        "status": "transit",
        "latest_record": {
          "context": "快件已到达上海分拨中心",
          "time": "2026-06-23T14:00:00.000Z"
        },
        "muted": false,
        "order_time": "2026-06-20T10:00:00.000Z",
        "created_at": "2026-06-20T12:00:00.000Z",
        "updated_at": "2026-06-23T14:00:00.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "page_size": 20
  }
}
```

### GET /parcels/:id

获取单个包裹详情（含完整物流轨迹）。

**Response**
```json
{
  "code": 0,
  "data": {
    "id": "parcel_xxx",
    "platform": "pdd",
    "order_id": "123456789",
    "tracking_number": "7730123456789",
    "courier": "中通快递",
    "courier_code": "zhongtong",
    "product_name": "智能手环",
    "product_image": "https://...",
    "status": "transit",
    "destination_city": "上海市",
    "arrived_at": null,
    "signed_at": null,
    "muted": false,
    "order_time": "2026-06-20T10:00:00.000Z",
    "created_at": "2026-06-20T12:00:00.000Z",
    "tracking_records": [
      {
        "context": "快件已到达上海分拨中心",
        "status_category": "arrived_city",
        "city": "上海市",
        "time": "2026-06-23T14:00:00.000Z",
        "is_key_event": true
      },
      {
        "context": "快件已从杭州发出",
        "status_category": "in_transit",
        "city": "杭州市",
        "time": "2026-06-22T08:00:00.000Z",
        "is_key_event": false
      }
    ]
  }
}
```

### PUT /parcels/:id/mute

切换包裹静音状态。

**Request**
```json
{
  "muted": true
}
```

**Response**
```json
{ "code": 0, "data": { "muted": true } }
```

### DELETE /parcels/:id

删除包裹（同时删除关联的 tracking_records）。

**Response**
```json
{ "code": 0, "data": { "deleted_at": "..." } }
```

### GET /parcels/stats

获取统计数据。

**Query**
```
?month=2026-06
```

**Response**
```json
{
  "code": 0,
  "data": {
    "total": 42,
    "current_month": 8,
    "platforms": {
      "pdd": 18,
      "jd": 14,
      "taobao": 10
    },
    "monthly_trend": [
      { "month": "2026-01", "count": 12 },
      { "month": "2026-02", "count": 8 }
    ],
    "couriers": [
      { "name": "中通快递", "count": 15 },
      { "name": "顺丰速运", "count": 10 }
    ]
  }
}
```

---

## 4.4 设置接口

### GET /settings

获取用户设置。

**Response**
```json
{
  "code": 0,
  "data": {
    "quiet_hours_enabled": true,
    "quiet_hours_start": "22:00",
    "quiet_hours_end": "08:00",
    "notify_on_arrival": true,
    "notify_on_signed": true,
    "notify_on_abnormal": true,
    "max_daily_notifications": 20,
    "subscribe_templates": {
      "arrived": "已申请" | "未申请",
      "signed": "已申请" | "未申请"
    }
  }
}
```

### PUT /settings

更新用户设置。

**Request**
```json
{
  "quiet_hours_enabled": false,
  "quiet_hours_start": "23:00",
  "quiet_hours_end": "07:00",
  "notify_on_arrival": true,
  "notify_on_signed": true,
  "notify_on_abnormal": false
}
```

**Response**
```json
{ "code": 0, "data": { "updated": true } }
```

---

## 4.5 引擎控制接口

### POST /engine/trigger

手动触发指定平台的订单同步。

**Request**
```json
{
  "platform": "pdd"
}
```

**Response**
```json
{
  "code": 0,
  "data": {
    "task_id": "task_xxx",
    "status": "started"
  }
}
```

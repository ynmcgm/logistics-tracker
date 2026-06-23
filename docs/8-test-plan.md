# 8. 测试计划

## 8.1 测试策略

| 层级 | 覆盖 | 运行方式 | 频率 |
|---|---|---|---|
| 单元测试 | 工具函数、解析器、状态机 | `node --test` | 每次提交 |
| 集成测试 | 云函数接口、数据库操作 | `node --test` + CloudBase 模拟 | 每次提交 |
| E2E 测试 | Playwright 引擎（登录→抓单→解析） | `node --test` + 实际 Chromium | 手动/CI |
| 手动验证 | 小程序真机测试 | 微信开发者工具 | 版本发布前 |

## 8.2 单元测试

### 8.2.1 工具函数测试

**文件**: `tests/unit/parsers.test.js`

| 测试用例 | 输入 | 预期输出 |
|---|---|---|
| 解析拼多多订单号 | `"订单编号：123456789012345678"` | `"123456789012345678"` |
| 解析京东订单号 | `"订单号：1234567890"` | `"1234567890"` |
| 解析运单号（标准） | `"运单号：773012345678"` | `"773012345678"` |
| 解析运单号（SF） | `"快递单号：SF1234567890"` | `"SF1234567890"` |
| 解析运单号（JD） | `"物流单号：JD1234567890"` | `"JD1234567890"` |
| 检测快递公司（中通） | `"773012345678"` | `{ name: "中通快递", code: "zhongtong" }` |
| 检测快递公司（顺丰） | `"SF1234567890"` | `{ name: "顺丰速运", code: "shunfeng" }` |
| 检测快递公司（未知） | `"12345"` | `null` |
| 运单号脱敏 | `"773012345678"` | `"7730****5678"` |
| 无匹配时返回 null | `"不包含运单号的文本"` | `null` |
| 批量文本解析 | 含多个运单号的文本 | 返回首个匹配 |

### 8.2.2 状态检测引擎测试

**文件**: `tests/unit/status-detector.test.js`

| 测试用例 | 输入文本 | 预期状态分类 |
|---|---|---|
| 已揽收 | `"快件已被揽收"` | `collected` |
| 运输中 | `"快件已从广州发往上海"` | `in_transit` |
| 到达目的地 | `"快件已到达上海分拨中心"` | `arrived_city` |
| 到达目的地（精度：区） | `"快件已到达上海市浦东新区"` | `arrived_city` |
| 派送中 | `"快件已交给快递员，正在派送"` | `delivering` |
| 已签收 | `"快件已被本人签收"` | `signed` |
| 已签收（代收） | `"已由小区收发室代收"` | `signed` |
| 放入快递柜 | `"已投递至丰巢快递柜"` | `signed` |
| 异常-退回 | `"因地址不详，快件退回发件人"` | `abnormal` |
| 异常-滞留 | `"快件长时间未更新"` | `abnormal` |
| 普通中转 | `"已到达杭州中转站"` | `other` |
| 正常运输 | `"快件正在发往下一站"` | `other` |

### 8.2.3 通知决策测试

**文件**: `tests/unit/notification-decision.test.js`

| 测试用例 | 场景 | 预期结果 |
|---|---|---|
| 到达城市 → 应推送 | 状态 `arrived_city`，未推送过 | `should_notify: true` |
| 已签收 → 应推送 | 状态 `signed`，未推送过 | `should_notify: true` |
| 运输中 → 不推送 | 状态 `in_transit` | `should_notify: false` |
| 已揽收 → 不推送 | 状态 `collected` | `should_notify: false` |
| 重复状态 → 不推送 | 24 小时内相同状态已推送过 | `should_notify: false` |
| 静音包裹 → 不推送 | `muted: true` | `should_notify: false` |
| 用户关闭通知 → 不推送 | `notify_on_arrival: false` | `should_notify: false` |
| 免打扰时段 → 延迟 | 当前 23:00，免打扰 22:00-08:00 | `delay_until: '次08:01'` |

### 8.2.4 Session 管理测试

**文件**: `tests/unit/session-manager.test.js`

| 测试用例 | 说明 |
|---|---|
| cookie → 加密 → 解密 → 还原 | 验证加解密流程正确 |
| cookie 过期检测 | 验证 session 有效性判断 |
| 连续失败标记过期 | 3 次验证失败后标记 expired |

## 8.3 集成测试

### 8.3.1 API 接口测试

**文件**: `tests/integration/api.test.js`

使用 CloudBase 本地模拟器（`@cloudbase/testing`）测试云函数。

| 测试用例 | 端点 | 验证 |
|---|---|---|
| 获取包裹列表 | `GET /parcels` | 返回正确结构，分页正常 |
| 获取空列表 | `GET /parcels` (新用户) | 返回空数组 |
| 获取单个包裹 | `GET /parcels/:id` | 含完整字段 + 轨迹列表 |
| 包裹不存在 | `GET /parcels/nonexist` | 报 1003 错误 |
| 切换静音 | `PUT /parcels/:id/mute` | 数据库更新 |
| 删除包裹 | `DELETE /parcels/:id` | 级联删除轨迹 |
| 获取绑定状态 | `GET /auth/bindings` | 返回 3 个平台状态 |
| 发起绑定 | `POST /auth/bind` | 返回 QR + session_id |
| 查询绑定状态 | `GET /auth/status` | 返回 pending/success |
| 解绑 | `POST /auth/unbind` | session 标记 revoked |
| 获取设置 | `GET /settings` | 返回用户配置 |
| 更新设置 | `PUT /settings` | 数据库更新 |

### 8.3.2 数据库操作测试

**文件**: `tests/integration/db.test.js`

| 测试用例 |
|---|
| 创建用户 → 查询用户 → 更新设置 |
| 创建包裹 → 添加轨迹 → 查询列表 |
| 轨迹去重（相同 context_hash 不会重复插入） |
| 包裹归档后不再出现在列表 |
| 通知队列入队 → 消费 → 发送日志 |

## 8.4 E2E 测试（手动/按需运行）

### 8.4.1 Playwright 引擎测试

**文件**: `tests/e2e/pdd-engine.test.js`

需要真实 CloudBase 环境或 Docker 环境运行，需要有效的 Session。

| 测试用例 | 说明 |
|---|---|
| 拼多多登录页打开 | 验证 QR 码元素出现 |
| QR 码截图返回 | 验证返回 base64 格式 |
| 扫码登录流程 | 手动扫码后验证 session 保存 |
| Session 恢复登录态 | 验证 cookie 恢复后能访问订单页 |
| 订单页抓取 | 验证解析出订单号和商品名 |
| 运单号提取 | 从物流详情提取运单号和快递公司 |
| 登录过期检测 | 使用过期 cookie 验证检测逻辑 |

### 8.4.2 快递100 API 集成测试

| 测试用例 | 说明 |
|---|---|
| 查询真实运单号 | 验证返回结果包含 status/context 字段 |
| 查询无效运单号 | 验证错误处理 |
| 频率限制处理 | 验证超限时返回正确错误码 |

## 8.5 手动验证清单

### 小程序真机测试

发布到微信小程序体验版后，逐项测试：

```
□ 首次打开 → 引导绑定 → 扫码登录 → 绑定成功
□ 首页显示已同步的包裹列表
□ 包裹卡片显示正确的状态和信息
□ 点击包裹 → 详情页显示完整时间线
□ 时间线关键节点高亮
□ 收到到城市推送（测试用模拟数据）
□ 收到签收推送（测试用模拟数据）
□ 设置页免打扰开关 → 检查推送时段正确
□ 包裹静音 → 不再收到该包裹通知
□ 解绑账号 → 不再同步该平台数据
□ 删除包裹 → 数据清理干净
□ 统计页数据正确
□ 设置页清除所有数据
```

## 8.6 测试数据

### 模拟运单号（用于测试快递100 API）

```
// 这些是真实且已签收的运单号，可用于测试 API 查询
// 注意：不要频繁查询，以免触发频率限制

const testTrackingNumbers = {
  zhongtong: "73123456789123",   // 中通
  shunfeng: "SF1234567890123",  // 顺丰
  yuantong: "YT1234567890123",  // 圆通
  yunda: "1234567890123",       // 韵达
  shentong: "123456789012345"   // 申通
}
```

## 8.7 测试运行命令

```bash
# 单元测试
node --test tests/unit/*.test.js

# 集成测试（需要 CloudBase 环境变量）
node --test tests/integration/*.test.js

# 全部测试
node --test tests/**/*.test.js

# E2E 测试（需要 Docker 环境）
docker build -t logistics-engine -f engines/docker/Dockerfile .
docker run --rm logistics-engine npm test
```

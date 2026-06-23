# 9. 部署方案

## 9.1 部署架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    微信小程序                              │
│  - 代码上传到微信公众平台（通过开发者工具/CLI）               │
│  - 云开发环境关联：开发 / 生产                              │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│              CloudBase 云开发（腾讯云）                       │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   云函数           │  │   云数据库         │               │
│  │   api-gateway     │  │   MongoDB         │               │
│  │   tracking-worker │  │   5 collections   │               │
│  │   engine-controller│  └──────────────────┘               │
│  │   notification-sender│                                   │
│  └──────────────────┘                                       │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         云托管 (CloudBase Run)                        │  │
│  │   Docker + Chromium + Playwright 引擎                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   云存储           │  │   日志服务         │               │
│  │   截图/调试文件     │  │   运行日志         │               │
│  └──────────────────┘  └──────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

## 9.2 前置条件

### 9.2.1 账号注册

| 平台 | 用途 | 链接 | 费用 |
|---|---|---|---|
| 微信小程序 | 发布小程序 | https://mp.weixin.qq.com | 个人 ¥30/年认证费 |
| CloudBase | 云开发 | https://console.cloud.tencent.com/tcb | 有免费额度 |
| 快递100 | 物流查询 API | https://api.kuaidi100.com | 个人免费（日 100 次） |
| GitHub | 代码托管 | https://github.com | 免费 |

### 9.2.2 开发工具

| 工具 | 用途 | 安装方式 |
|---|---|---|
| 微信开发者工具 | 小程序开发/调试/上传 | 官网下载安装 |
| CloudBase CLI | 云函数/云托管部署 | `npm i -g @cloudbase/cli` |
| Docker Desktop | 本地测试引擎 | 官网下载安装 |
| Node.js ≥ 18 | 运行环境 | 已安装 |

## 9.3 微信小程序配置

### 9.3.1 创建小程序

1. 登录 [微信公众平台](https://mp.weixin.qq.com)
2. 注册小程序（选择个人主体，¥30 认证费）
3. 获取 AppID（在小程序开发设置中）

### 9.3.2 开通云开发

1. 在微信开发者工具中点击「云开发」
2. 开通云开发环境（自动创建第一个环境）
3. 建议创建两个环境：`dev`（开发）和 `prod`（生产）

### 9.3.3 配置订阅消息

1. 小程序管理后台 → 功能 → 订阅消息
2. 在公共模板库中搜索并选用以下模板：
   - `包裹到达通知`（需 4 个字段）
   - `包裹签收通知`（需 4 个字段）
3. 记录模板 ID → 配置到代码中

### 9.3.4 配置小程序项目

在微信开发者工具中：
1. 项目目录选择 `miniprogram/miniprogram/`
2. AppID 填写注册得到的 AppID
3. 云开发环境 ID 填写到 `miniprogram/miniprogram/app.js` 中的 `env`
4. 本地开发勾选「不校验合法域名」

## 9.4 CloudBase 部署

### 9.4.1 安装 CLI

```bash
npm install -g @cloudbase/cli

# 登录（会打开浏览器授权）
tcb login

# 关联云开发环境
tcb init
```

### 9.4.2 部署云函数

```bash
# 部署所有云函数
cd miniprogram/cloudfunctions

# 逐个部署
tcb functions deploy api-gateway
tcb functions deploy tracking-worker
tcb functions deploy engine-controller
tcb functions deploy notification-sender

# 或批量部署
tcb functions deploy --all
```

### 9.4.3 云函数配置

| 云函数 | 内存 | 超时 | 触发器 |
|---|---|---|---|
| api-gateway | 128MB | 30s | HTTP 触发 |
| tracking-worker | 256MB | 120s | 定时: 每 2 小时 |
| engine-controller | 256MB | 300s | HTTP + 定时: 每日 3 次 |
| notification-sender | 128MB | 60s | 定时: 每 1 分钟 |

### 9.4.4 云函数环境变量

所有云函数需配置的共同环境变量：

```
ENV_ID:           xxx-xxxxxx    # CloudBase 环境 ID
KUAIDI100_KEY:    xxxxxxxx      # 快递100 API Key
KUAIDI100_CUSTOMER: xxxxxx      # 快递100 Customer ID
```

engine-controller 额外配置：

```
ENCRYPTION_KEY:   xxx           # AES-256 密钥（32位）
PLATFORMS:        pdd           # 启用的平台，逗号分隔
```

## 9.5 云托管部署（Playwright 引擎）

### 9.5.1 构建 Docker 镜像

```bash
cd engines

# 本地构建测试
docker build -t logistics-engine -f docker/Dockerfile .

# 本地运行测试
docker run --rm -e ENCRYPTION_KEY=test -e PLATFORMS=pdd logistics-engine
```

### 9.5.2 推送到 CloudBase 云托管

```bash
# 方式一：通过命令行
tcb run deploy --name engine --port 3000 --service-name logistics-engine

# 方式二：通过 CloudBase 控制台
# 1. 登录 https://console.cloud.tencent.com/tcb
# 2. 进入云托管
# 3. 创建服务: logistics-engine
# 4. 上传 Docker 镜像
# 5. 配置:
#    - 端口: 3000
#    - 实例数: 1 (最低)
#    - 内存: 1GB (Playwright + Chromium 需要)
#    - 扩缩容: 0-2
```

### 9.5.3 云托管配置

```yaml
# cloudbaserc.yaml (项目根目录)
{
  "envId": "xxx-xxxxxx",
  "framework": {
    "plugins": {
      "cloudfunctions": {
        "use": "@cloudbase/framework-plugin-function",
        "inputs": {
          "functions": [
            {"name": "api-gateway", ...},
            {"name": "tracking-worker", ...},
            {"name": "engine-controller", ...},
            {"name": "notification-sender", ...}
          ]
        }
      },
      "cloudrun": {
        "use": "@cloudbase/framework-plugin-container",
        "inputs": {
          "serviceName": "logistics-engine",
          "source": "engines",
          "dockerfilePath": "engines/docker/Dockerfile",
          "port": 3000,
          "cpu": 1,
          "memory": "1Gi",
          "envParams": {
            "ENCRYPTION_KEY": "",
            "PLATFORMS": "pdd"
          }
        }
      }
    }
  }
}
```

## 9.6 快递100 配置

### 9.6.1 注册账号

1. 打开 https://api.kuaidi100.com
2. 注册个人账号
3. 完成个人实名认证（免费）

### 9.6.2 获取 API 密钥

1. 进入控制台 → API 管理
2. 获取 `key` 和 `customer` 参数
3. 免费版限制：每天 100 次查询

### 9.6.3 API 接口选择

使用「实时查询」接口（免费版可用）：

```
POST https://poll.kuaidi100.com/poll/query.do
参数: customer, sign, param (含 company, num)
```

## 9.7 环境变量完整清单

| 变量 | 说明 | 来源 | 必填 |
|---|---|---|---|
| ENV_ID | CloudBase 环境 ID | 云开发控制台 | ✅ |
| KUAIDI100_KEY | 快递100 密钥 | 快递100 控制台 | ✅ |
| KUAIDI100_CUSTOMER | 快递100 客户标识 | 快递100 控制台 | ✅ |
| ENCRYPTION_KEY | AES-256 加密密钥（32字符） | 自行生成 | ✅ |
| WECHAT_APPID | 小程序 AppID | 微信公众平台 | ✅ |
| PLATFORMS | 启用的平台列表 | 配置 | ✅ |
| LOG_LEVEL | 日志级别 (debug/info/warn/error) | 配置 | |

## 9.8 部署顺序

```
第1步: 微信小程序注册 + 云开发开通
         ↓
第2步: 快递100 注册 + 获取 API Key
         ↓
第3步: 配置云函数环境变量
         ↓
第4步: 部署云函数 → 测试 HTTP API
         ↓
第5步: 构建 Docker 镜像 → 部署云托管
         ↓
第6步: 配置定时触发器
         ↓
第7步: 配置订阅消息模板
         ↓
第8步: 小程序前端上传 → 提交体验版
         ↓
第9步: 真机测试 → 验证全流程
         ↓
第10步: 提交审核 → 发布正式版
```

## 9.9 CI/CD (后续可选)

GitHub Actions 自动构建 Docker 镜像并部署到 CloudBase：

```yaml
# .github/workflows/deploy.yml (后续配置)
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy-cloudrun:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to CloudBase
        uses: TencentCloudBase/cloudbase-action@v2
        with:
          secretId: ${{ secrets.SECRET_ID }}
          secretKey: ${{ secrets.SECRET_KEY }}
          envId: ${{ secrets.ENV_ID }}
```

## 9.10 版本发布流程

| 阶段 | 操作 | 验证 |
|---|---|---|
| 开发 | 本地 + 微信开发者工具 | 单元测试通过 |
| 体验版 | 小程序上传为体验版（仅开发者可看） | 真机全流程测试 |
| 灰度 | 设置 10% 用户可访问 | 观察 3 天无异常 |
| 全量 | 提交微信审核 → 发布 | 线上监控 |

## 9.11 监控与告警

| 指标 | 监控方式 | 告警阈值 |
|---|---|---|
| 云函数错误率 | CloudBase 日志 | > 5% |
| 引擎执行失败 | 自定义日志 | 连续 3 次失败 |
| 快递100 API 错误 | 自定义日志 | 连续 5 次失败 |
| 通知发送失败 | 通知日志 | 日失败率 > 10% |
| Session 过期 | 数据库查询 | 超过 3 个 session 过期 |

## 9.12 实际部署记录

> 本节记录首次部署的实际过程和配置值，作为运维档案。

### 部署日期
- **首次部署**：2026-06-23
- **部署方式**：CloudBase CLI 3.5.7（通过 Sisyphus AI Agent 执行）

### 已注册账号

| 平台 | 账号 | 用途 |
|---|---|---|
| GitHub | ynmcgm | 代码托管 |
| 微信小程序 | ynmc@163.com | 小程序 AppID: `wx19349197c537e97e` |
| CloudBase | logistics-tracker-prod-d7bae6369 | 云开发环境 |
| 快递100 | 手机号注册 | API Key + Customer |

### 已部署的云函数

| 函数名 | 超时 | 环境变量 | 触发器 |
|---|---|---|---|
| api-gateway | 30s | KUAIDI100_KEY, KUAIDI100_CUSTOMER | HTTP 触发 |
| tracking-worker | 120s | KUAIDI100_KEY, KUAIDI100_CUSTOMER | `0 */2 * * *`（每2小时） |
| engine-controller | 300s | KUAIDI100_KEY, KUAIDI100_CUSTOMER, PLATFORMS=pdd, ENGINE_HOST | `0 8,14,20 * * *`（每日3次） |
| notification-sender | 60s | KUAIDI100_KEY, KUAIDI100_CUSTOMER | `*/1 * * * *`（每分钟） |

### 部署命令记录

```bash
# 安装 CLI
npm install -g @cloudbase/cli

# 登录（扫码授权）
tcb login

# 部署云函数
tcb fn deploy api-gateway -e logistics-tracker-prod-d7bae6369
tcb fn deploy tracking-worker -e logistics-tracker-prod-d7bae6369
tcb fn deploy engine-controller -e logistics-tracker-prod-d7bae6369
tcb fn deploy notification-sender -e logistics-tracker-prod-d7bae6369

# 配置环境变量和触发器（从 cloudbaserc.json 推送）
tcb config update fn api-gateway -e logistics-tracker-prod-d7bae6369
tcb config update fn tracking-worker -e logistics-tracker-prod-d7bae6369
tcb config update fn engine-controller -e logistics-tracker-prod-d7bae6369
tcb config update fn notification-sender -e logistics-tracker-prod-d7bae6369
```

### 云函数版本

| 函数 | 状态 | 备注 |
|---|---|---|
| api-gateway | ✅ 运行中 | lam-drqudaax |
| tracking-worker | ✅ 运行中 | lam-2eonkg4j |
| engine-controller | ✅ 运行中 | lam-qdjz1s4r |
| notification-sender | ✅ 运行中 | lam-k165hbhl |

### 小程序预览修复记录

| 日期 | 问题 | 原因 | 修复 |
|---|---|---|---|
| 2026-06-23 | tabBar 图标缺失 | `images/` 目录不存在，8 个图标文件未创建 | 生成 81x81 PNG 图标（盒子/人物/柱状图/齿轮，灰度+绿色两套） |
| 2026-06-23 | WXML 编译错误 | WXML 模板不支持可选链 `?.` 运算符 | index.wxml: `item.latest_record?.context` → `item.latest_record && item.latest_record.context`；stats.wxml 4 处同样问题 |
| 2026-06-23 | WXML 嵌套三目运算符 | WXML 不支持嵌套 `a ? b : c ? d : e` 表达式 | bind.wxml 和 detail.wxml 改为在 JS 中预计算平台名 → 模板直接引用 `platformName` |

### 当前套餐

| 项 | 值 |
|---|---|
| 套餐版本 | **体验版**（免费，6个月） |
| 创建时间 | 2026-06-23 |
| 到期时间 | 2026-12-23 |
| 环境 ID | logistics-tracker-prod-d7bae6369 |

> **注意：** 体验版不支持云托管（CloudBase Run）。Playwright 引擎需要部署到云托管才能运行，
> 因此需要**升级到个人版（¥19.9/月）** 才能继续部署引擎。

### 待部署 / 待操作

| 组件 | 前提条件 | 备注 |
|---|---|---|
| Playwright 引擎（云托管 Docker） | ⚠️ **需先升级到个人版 ¥19.9/月** | Chromium 约需 1GB 内存 |
| 微信订阅消息模板 | 登录微信公众平台 → 功能 → 订阅消息 | 需申请两个模板（物流状态变更、登录提醒） |
| 微信小程序备案 | 上线前操作 | 需准备身份证等信息 |
| 微信认证（¥30/年） | 上线前操作 | 不认证也能开发预览，发布必须 |

## 9.13 费用预估（个人使用）

| 项目 | 月费用 | 说明 |
|---|---|---|
| CloudBase 套餐升级（个人版） | ¥19.9/月 | 必选，否则无法部署云托管引擎 |
| CloudBase 云托管 | ~¥0-10 | 按量计费，定时触发可缩容到 0 |
| CloudBase 云函数 + 数据库 | 免费 | 月调用 + 1GB 存储免费额度够用 |
| 微信小程序认证 | ¥2.5/月 | 年费 ¥30 均摊 |
| 快递100 API | 免费 | 日 100 次，个人够用 |
| **合计** | **~¥22.4-32.4/月** | 主要固定开支是 CloudBase 个人版 ¥19.9/月 |

> 如果不升级到个人版，Playwright 引擎无法部署。另一个选择是改用纯 API 方案
> （绕过浏览器渲染），但 PDD/Taobao/JD 都需要 JS 执行解析，Playwright 无法替代。

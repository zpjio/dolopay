<div align="center">

**简体中文** | [English](./README_EN.md)

# DoloPay（独行付）

**专为独立开发者打造的轻量级个人收款码与多渠道审批网关**  
*Lightweight Personal QR Code Payment & Multi-Channel Approval Gateway for Indie Developers*

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Fee](https://img.shields.io/badge/Gateway%20Fee-0%25%20Direct-10B981.svg)](#)
[![Core](https://img.shields.io/badge/Default-Email%20%7C%20Feishu%20%7C%20DingTalk-2563EB.svg)](#二3-分钟开箱即用部署指南)
[![Plugins](https://img.shields.io/badge/Plugins-UnionPay%20%7C%20EPay%20%7C%20Android-0F172A.svg)](#四模块化扩展与按需裁剪指南)

**无需营业执照 · 0% 手续费直达个人支付宝/微信 · 默认邮件 / 飞书 / 钉钉一键核销（零风控）**  
默认极简开箱，3 分钟上线收款；云闪付、易支付协议、Stripe Webhook、Bark/Telegram 与安卓监听均以独立插件按需启停、轻松裁剪。

</div>

---

## 一、 实际使用场景与架构定位

绝大多数独立开发者、开源作者和个人站长在商业化初期，每天往往只有**几笔到几十笔收款**（卖软件授权、付费内容、API 额度、咖啡赞赏等）：
- 申请企业支付资质门槛高、维护成本重；
- 第三方聚合代收抽成高，还存在 T+N 冻结或跑路风险；
- 长期挂闲置安卓机监听通知栏不仅容易断网掉线，也存在额外的账号风控顾虑。

因此，**DoloPay v3 采用「极简核心 + 模块化插件扩展」分层设计**：

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  核心开箱层（默认开启，0 噪音，3 分钟上手）                                   │
│  • 收款渠道：个人支付宝 + 微信支付（支持后台传原图 / 目录替换图片）             │
│  • 对账方式：原价收款 + 6 位简短付款口令（不改动买家支付金额，体验最自然）       │
│  • 审批通道：邮件 (SMTP) / 飞书机器人 / 钉钉机器人（支持单选或多渠道同时推送）   │
│  • 手机审批：点击通知里的 HMAC 签名链接 -> 独立确认页点一次按钮通过或驳回        │
│  • 开放接口：简洁 DoloPay REST API v1 + 签名回调到您自己的业务站点             │
├────────────────────────────────────────────────────────────────────────────┤
│  模块化扩展层（默认关闭，后台一键开启，或通过环境变量/删注册项彻底剪除）         │
│  • 支付渠道扩展：云闪付 (unionpay)                                          │
│  • 审批通知扩展：Bark iOS 强提醒 (bark)、Telegram Bot (telegram)             │
│  • 协议兼容扩展：易支付兼容协议 MD5 (epay，对接独角数卡/V2Board)、Stripe (stripe)│
│  • 自动对账扩展：安卓通知监听 Webhook (androidListener) + 分位浮动锁 (centFloat)│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、 3 分钟开箱即用部署指南

### 第 1 步：克隆并启动服务

环境要求：Node.js `>= 20.x`

```bash
git clone https://github.com/your-org/dolopay.git
cd dolopay
npm install
cp .env.example .env

# 开发/测试运行（默认端口 3000）
npm run dev

# 生产构建并启动
npm run build
NODE_ENV=production npm start
```

> **首次管理员登录说明**：  
> 您可以在 `.env` 中设置 `DOLOPAY_ADMIN_PASSWORD=您的强口令`；如果未填写，首次打开管理后台（订单与核销 / 收款码配置 / 审批与接入）时，网页会自动引导您设置一次管理员口令并以 `scrypt` 加密保存在本地 `.data/dolopay-store.json` 中。

---

### 第 2 步：配置您自己的个人收款码（两种方式任选其一）

先从手机导出您的个人收款码原图：
- **支付宝**：打开支付宝 → 顶部「收付款」→「二维码收款」→「保存图片」
- **微信**：打开微信 → 右上角 `+` →「收付款」→「二维码收款」→「保存收款码」

**方式 A：管理后台直接上传（最推荐，无需动服务器文件）**
1. 进入管理后台 **「收款码配置」** 标签页；
2. 点击支付宝 / 微信卡片中的 **「上传个人收款码原图」**，选择刚保存的 PNG / JPG / WebP 原图（≤ 2MB）；
3. 填写脱敏收款提示（如 `张*明`），收银台立即展示您的真实收款码。

**方式 B：直接替换本地静态目录（适合 Git / Docker 自动化部署）**
1. 将两张收款码图片重命名后直接放入项目的 `public/qrcodes/` 目录：
   - `public/qrcodes/alipay.png`（也支持 `.jpg` / `.webp`）
   - `public/qrcodes/wechat.png`（也支持 `.jpg` / `.webp`）
2. 刷新收银台页面即可自动识别生效（如果同时在后台上传过图片，以后台上传的 `.data/qrcodes/` 为优先）。

---

### 第 3 步：配置审批通知（邮件 / 飞书 / 钉钉，任选其一或同时开启！）

> 无论是**邮件**、**飞书**还是**钉钉**，都支持直接在 **「审批与接入」** 网页后台填写并点击 **「保存并发送测试」** 一键验证，也可以写入 `.env` 启动自动生效。
>
> **记得填写 `PUBLIC_BASE_URL`**（例如 `https://pay.yourdomain.com`），以便生成的手机端一键审批链接能在公网直接点开。

#### 方案 A：邮件审批（SMTP · 最轻量，几乎零门槛）

以最常见的 **QQ 邮箱** 为例（同样支持 163 邮箱、Gmail、Resend SMTP）：
1. 登录网页版 QQ 邮箱 →「设置」→「账号」→ 向下找到 **POP3/IMAP/SMTP 服务**，开启「IMAP/SMTP 服务」，按提示获取 **16 位授权码**（注意：不是 QQ 登录密码）。
2. 在后台 **「审批与接入 → 邮件审批」** 点击「QQ 邮箱」快捷预设，或写入 `.env`：

```env
PUBLIC_BASE_URL=https://pay.yourdomain.com
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your_qq@qq.com
SMTP_PASS=你的16位授权码
ADMIN_EMAIL=your_qq@qq.com
```

常用邮箱参数速查：

| 邮箱服务商 | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` / `SMTP_PASS` 说明 |
| :--- | :--- | :--- | :--- |
| **QQ 邮箱** | `smtp.qq.com` | `465` | QQ 邮箱地址 / 网页设置获取的 16 位授权码 |
| **163 邮箱** | `smtp.163.com` | `465` | 163 邮箱地址 / 开启 SMTP 后的授权密码 |
| **Gmail** | `smtp.gmail.com` | `465` | Gmail 地址 / Google 账号「应用专用密码」 |
| **Resend** | `smtp.resend.com` | `465` | 用户名固定填 `resend` / 密码填 Resend API Key（免费 3,000 封/月） |

#### 方案 B：飞书群机器人审批（30 秒配好，手机体验极佳）

1. 在飞书创建一个只有您自己的个人群（或收款通知群）；
2. 点击群右上角「设置」→「群机器人」→「添加机器人」→ 选择 **「自定义机器人」**；
3. 复制生成的 **Webhook 地址**（推荐同时勾选「签名校验」并复制密钥）；
4. 粘贴到后台「审批与接入 → 飞书群机器人」并点击 **「保存并发送测试卡片」**，或写入 `.env`：

```env
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
FEISHU_WEBHOOK_SECRET=可选签名密钥
```

#### 方案 C：钉钉群机器人审批（30 秒配好，支持官方加签）

1. 在钉钉建一个个人/团队收款群 → 群设置 →「智能群助手」→ 添加 **「自定义机器人」**；
2. 安全设置推荐勾选 **「加签」**，复制 `SEC...` 开头的加签密钥与 Webhook 地址；
3. 粘贴到后台「审批与接入 → 钉钉群机器人」并点击 **「保存并发送测试卡片」**，或写入 `.env`：

```env
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxxxxxxx
DINGTALK_WEBHOOK_SECRET=SECxxxxxxxxxxxxxxxx
```

> **多渠道并发支持**：您可以同时勾选启用「邮件 + 飞书 + 钉钉」，买家点击「我已支付」后服务端将并发推送至全部已配置通道。点击任意通知里的签名链接都会进入极简的**手机端确认页**（采用 `GET` 只读验签 + `POST` 按钮确认，防止邮件客户端或聊天软件预加载误核销）。

---

## 三、 自有网站接入 REST Open API

如果您想把 DoloPay 接入自己的 SaaS、博客或小工具网站，只需两步：

### 1. 创建收款单 (`POST /api/v1/orders/create`)

在后台「审批与接入」复制 `AppID` 与 `AppSecret`，按参数名 **ASCII 字典序** 拼接 `k1=v1&k2=v2...&key=<AppSecret>` 后计算 `HMAC-SHA256` 填入 `sign`：

```json
{
  "appId": "dolopay_main",
  "outTradeNo": "ORD_20261121_001",
  "channel": "alipay",
  "amount": "19.90",
  "productTitle": "Pro 永久授权",
  "attach": "userId=1024",
  "notifyUrl": "https://api.yoursite.com/webhooks/dolopay",
  "sign": "<64位 HMAC-SHA256 十六进制签名>"
}
```

成功响应返回 `data.cashierUrl`，直接将买家跳转至该收银台链接即可。

### 2. 接收核销回调 (`notifyUrl`)

管理员在手机确认收款（或安卓监听自动核销）后，DoloPay 会向您的 `notifyUrl` 发送 `POST` JSON 请求，并携带以下请求头供您验签与幂等去重：
- `X-DoloPay-App-Id`
- `X-DoloPay-Timestamp`
- `X-DoloPay-Signature`（与下单一致的 `HMAC-SHA256` 签名）
- `Idempotency-Key`

---

## 四、 模块化扩展与按需裁剪指南

所有进阶能力均注册在 `src/core/pluginRegistry.ts`，**默认全部关闭**。您既可以在管理后台「审批与接入 → 模块化扩展中心」一键开关，也可以通过 `.env` 控制：

| 插件 ID | 功能说明 | 启用方式 |
| :--- | :--- | :--- |
| `unionpay` | 云闪付个人收款码渠道 | 后台开启，并上传图片或放入 `public/qrcodes/unionpay.png` |
| `bark` | Bark (iOS) 实时强提醒审批推送 | 后台开启，填入 `BARK_PUSH_URL` |
| `telegram` | Telegram Bot 带内联按钮审批通知 | 后台开启，填入 `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID` |
| `epay` | **易支付兼容协议 (MD5)**，零代码对接独角数卡 / V2Board / WHMCS | 后台开启，创建易支付应用后把 `/api/v1/epay/`、PID、KEY 填入插件 |
| `stripe` | Stripe 风格时间戳签名 Webhook (`X-DoloPay-Signature: t=...,v1=...`) | 后台开启，新建 Stripe 协议应用 |
| `androidListener` | **安卓通知栏自动监听 Webhook** (`POST /api/v1/webhook/notify`) | 后台开启，配置 `DOLOPAY_ANDROID_SECRET` 与 Tasker/监听端 |
| `centFloat` | **并发分位金额浮动锁 (±0.01)**，解决同额并发自动匹配问题 | 建议在开启安卓自动监听且并发较高时开启 |

### 通过环境变量预设或彻底剪除扩展

```env
# 1. 启动时默认开启云闪付 + 易支付协议
DOLOPAY_ENABLED_PLUGINS=unionpay,epay

# 2. 部署时彻底屏蔽不需要的扩展（后台开关将被锁定不可开启）
DOLOPAY_DISABLED_PLUGINS=stripe,bark,telegram
```

二次开发者如需从源码级彻底移除某个扩展，只需在 `src/core/pluginRegistry.ts` 中删除对应注册项即可，完全不影响核心收银与邮件/飞书/钉钉审批流程。

---

## 五、 常用运维与测试命令

```bash
# 运行核心引擎与插件机制单元测试
npx --yes tsx --test src/core/dolopayEngine.test.ts

# 类型检查与前端构建
npm run lint
npm run build
```

---

## 六、 开源许可 (License)

Copyright © 2026 **zpjio**. 本项目基于 [**Apache-2.0 License**](./LICENSE) 开源（归属声明见 [`NOTICE`](./NOTICE)）。本软件按“原样（AS IS）”提供，部署者须自行确保业务符合当地法律法规及对应支付平台条款。

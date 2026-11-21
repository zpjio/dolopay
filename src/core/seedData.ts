/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  signOrderApprovalToken,
  type ConnectedApp,
  type DoloPayOrder,
  type GatewaySettings,
  type PaymentChannel,
  type QrChannelSlot,
  type SecurityAuditEvent,
} from './dolopayEngine';
import { createDefaultPluginStates } from './pluginRegistry';

export const CHANNEL_META: Record<
  PaymentChannel,
  {
    name: string;
    shortName: string;
    appHint: string;
    accentText: string;
    accentBg: string;
    softBg: string;
    border: string;
    staticFileHint: string;
  }
> = {
  alipay: {
    name: '支付宝个人收款码',
    shortName: '支付宝',
    appHint: '打开支付宝 [扫一扫] 付款',
    accentText: 'text-blue-600',
    accentBg: 'bg-blue-600',
    softBg: 'bg-blue-50',
    border: 'border-blue-200',
    staticFileHint: 'public/qrcodes/alipay.png',
  },
  wechat: {
    name: '微信个人收款码',
    shortName: '微信支付',
    appHint: '打开微信 [扫一扫] 付款',
    accentText: 'text-emerald-600',
    accentBg: 'bg-emerald-600',
    softBg: 'bg-emerald-50',
    border: 'border-emerald-200',
    staticFileHint: 'public/qrcodes/wechat.png',
  },
  unionpay: {
    name: '云闪付个人收款码',
    shortName: '云闪付',
    appHint: '打开云闪付或银行 App [扫一扫]',
    accentText: 'text-rose-600',
    accentBg: 'bg-rose-600',
    softBg: 'bg-rose-50',
    border: 'border-rose-200',
    staticFileHint: 'public/qrcodes/unionpay.png',
  },
};

export const PROTOCOL_META = {
  DOLOPAY_REST_V1: {
    name: 'DoloPay REST API v1',
    shortName: 'REST v1 (HMAC-SHA256)',
    desc: '标准 JSON + ASCII 字典序 HMAC-SHA256 签名，适合个人网站与自研 SaaS 接入',
  },
  EPAY_COMPAT: {
    name: '易支付兼容协议 (EPay · MD5)',
    shortName: '易支付兼容 (MD5)',
    desc: '标准 RFC 1321 MD5 签名，零代码对接独角数卡、鲸发卡、V2Board、WHMCS 等现成插件',
  },
  STRIPE_WEBHOOK: {
    name: 'Stripe 风格签名事件流',
    shortName: 'Stripe Webhook',
    desc: '采用 X-DoloPay-Signature: t=...,v1=... 时间戳防重放签名头',
  },
} as const;

export const SMTP_PRESETS = [
  {
    id: 'qq',
    label: 'QQ 邮箱',
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    tip: '账号填 QQ 邮箱，密码填在 QQ 邮箱「设置 → 账号 → POP3/SMTP」获取的 16 位授权码',
  },
  {
    id: '163',
    label: '163 邮箱',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    tip: '账号填 163 邮箱，密码填在网页版「设置 → POP3/SMTP」开启后生成的授权密码',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    tip: '开启 Google 两步验证后，在「应用专用密码」生成 16 位密码填入',
  },
  {
    id: 'resend',
    label: 'Resend SMTP',
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    tip: '用户名固定为 resend，密码填写 Resend API Key（免费额度每月 3,000 封）',
  },
] as const;

export function createInitialGatewaySettings(runtimeSecrets: {
  androidWebhookSecret: string;
  publicBaseUrl?: string;
}): GatewaySettings {
  return {
    siteTitle: 'DoloPay 个人收银台',
    publicBaseUrl: runtimeSecrets.publicBaseUrl || '',
    orderTtlSeconds: 900,
    maxPendingPerIp: 5,
    rateLimitPerMinute: 30,
    floatStrategy: 'EXACT_THEN_INCREMENT',
    maxFloatSteps: 10,
    email: {
      enabled: true,
      host: '',
      port: 465,
      secure: true,
      user: '',
      pass: '',
      from: '',
      adminTo: '',
      sendBuyerReceipt: false,
    },
    feishu: {
      enabled: true,
      webhookUrl: '',
      secret: '',
    },
    dingtalk: {
      enabled: false,
      webhookUrl: '',
      secret: '',
    },
    bark: {
      pushUrl: '',
      group: 'DoloPay',
    },
    telegram: {
      botToken: '',
      chatId: '',
    },
    androidWebhookSecret: runtimeSecrets.androidWebhookSecret,
    webhookReplayWindowSeconds: 300,
    plugins: createDefaultPluginStates(),
  };
}

export function createInitialQrSlots(nowMs: number): Record<PaymentChannel, QrChannelSlot> {
  return {
    alipay: {
      channel: 'alipay',
      enabled: true,
      displayName: '个人支付宝收款',
      accountMask: '请在收款码配置中修改为您的脱敏账号',
      paymentTip: '扫码后请输入订单金额，并在付款备注中填写下方 6 位口令',
      updatedAt: nowMs,
    },
    wechat: {
      channel: 'wechat',
      enabled: true,
      displayName: '个人微信收款',
      accountMask: '请在收款码配置中修改为您的脱敏昵称',
      paymentTip: '扫码后请输入订单金额，并在「添加备注」中填写下方 6 位口令',
      updatedAt: nowMs,
    },
    unionpay: {
      channel: 'unionpay',
      enabled: true,
      displayName: '云闪付个人收款',
      accountMask: '请在收款码配置中修改为您的脱敏卡号',
      paymentTip: '扫码后输入订单金额，付款完成点击下方「我已支付」',
      updatedAt: nowMs,
    },
  };
}

export function createInitialConnectedApps(
  nowMs: number,
  defaultSecret: string
): ConnectedApp[] {
  return [
    {
      id: 'app_default_rest',
      name: '我的主站 / SaaS (默认 REST 应用)',
      appId: 'dolopay_main',
      appSecret: defaultSecret,
      protocol: 'DOLOPAY_REST_V1',
      notifyUrl: '',
      returnUrl: '',
      enabled: true,
      totalOrders: 2,
      totalPaidCents: 2990,
      createdAt: nowMs - 86400_000,
    },
  ];
}

export function createInitialOrders(nowMs: number, signingSecret: string): DoloPayOrder[] {
  const id1 = 'DP20261121002';
  const id2 = 'DP20261121001';
  return [
    {
      id: id1,
      outTradeNo: 'DEMO_ORD_002',
      appId: 'dolopay_main',
      appName: '我的主站 / SaaS',
      protocol: 'DOLOPAY_REST_V1',
      productTitle: '独立工具 Pro 永久授权（演示订单）',
      channel: 'alipay',
      nominalAmountCents: 1990,
      actualAmountCents: 1990,
      remarkCode: '581044',
      payerNickName: '陈默',
      payerEmail: 'chenmo@example.com',
      payerMessage: '已支付宝转 19.90，备注 581044，麻烦核对放行',
      clientIp: '127.0.0.1',
      status: 'AWAITING_APPROVAL',
      createdAt: nowMs - 180_000,
      expiresAt: nowMs + 720_000,
      approvalToken: signOrderApprovalToken(id1, nowMs, nowMs + 86400_000, signingSecret),
      notificationLogs: [
        {
          channel: 'feishu',
          channelName: '飞书机器人',
          ok: true,
          skipped: true,
          message: '演示订单（配置飞书 Webhook 后将自动推送真实交互审批卡片）',
          sentAt: nowMs - 120_000,
        },
      ],
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
      isDemo: true,
    },
    {
      id: id2,
      outTradeNo: 'DEMO_ORD_001',
      appId: 'dolopay_main',
      appName: '我的主站 / SaaS',
      protocol: 'DOLOPAY_REST_V1',
      productTitle: '开源项目咖啡赞赏（演示订单）',
      channel: 'wechat',
      nominalAmountCents: 1000,
      actualAmountCents: 1000,
      remarkCode: '310492',
      payerNickName: '林舟',
      payerEmail: 'linzhou@example.com',
      payerMessage: '加油，轻量邮件审批方案很实用',
      clientIp: '127.0.0.1',
      status: 'PAID',
      createdAt: nowMs - 3_600_000,
      expiresAt: nowMs - 2_700_000,
      paidAt: nowMs - 3_510_000,
      settlementMethod: 'APPROVAL_LINK',
      approvalToken: signOrderApprovalToken(id2, nowMs - 3_600_000, nowMs + 82_800_000, signingSecret),
      notificationLogs: [
        {
          channel: 'email',
          channelName: '邮件 SMTP',
          ok: true,
          skipped: true,
          message: '演示订单已通过签名确认页核销',
          sentAt: nowMs - 3_540_000,
        },
      ],
      webhookStatus: 'SKIPPED',
      webhookAttempts: 0,
      webhookLastResponse: '未配置下游 notifyUrl，跳过回调',
      isDemo: true,
    },
  ];
}

export function createInitialAuditLogs(nowMs: number): SecurityAuditEvent[] {
  return [
    {
      id: 'sec_init_01',
      timestamp: nowMs - 3_510_000,
      level: 'INFO',
      eventType: 'ORDER_APPROVED',
      clientIp: '127.0.0.1',
      summary: '演示订单 DP20261121001 (¥10.00) 已通过签名确认页核销入账',
    },
  ];
}

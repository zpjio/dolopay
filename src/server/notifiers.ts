/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import {
  buildMerchantWebhookEnvelope,
  centsToYuan,
  type ApprovalNotifierId,
  type ConnectedApp,
  type DoloPayOrder,
  type GatewaySettings,
  type NotificationDeliveryLog,
} from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import { escapeHtml, validateSafeOutboundUrl } from './security';

export interface ApprovalNotificationContext {
  order: DoloPayOrder;
  approvalUrl: string;
  isTest?: boolean;
}

interface ApprovalNotifierPlugin {
  id: ApprovalNotifierId;
  name: string;
  isCore: boolean;
  isEnabled: (settings: GatewaySettings) => boolean;
  isConfigured: (settings: GatewaySettings) => boolean;
  send: (settings: GatewaySettings, ctx: ApprovalNotificationContext) => Promise<string>;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildFeishuSignature(timestampSec: string, secret: string): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).digest('base64');
}

function buildDingTalkSignedUrl(webhookUrl: string, secret: string): string {
  if (!secret.trim()) return webhookUrl;
  const timestamp = String(Date.now());
  const stringToSign = `${timestamp}\n${secret.trim()}`;
  const sign = crypto
    .createHmac('sha256', secret.trim())
    .update(stringToSign, 'utf8')
    .digest('base64');
  const url = new URL(webhookUrl);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  return url.toString();
}

/**
 * 统一审批通知插件注册表：
 * - 核心默认（Core）：邮件 SMTP、飞书机器人、钉钉机器人（支持单选或同时多渠道并发推送）
 * - 可选扩展（Plugins）：Bark (iOS)、Telegram Bot（需在扩展中心开启）
 */
const NOTIFIER_PLUGINS: ApprovalNotifierPlugin[] = [
  {
    id: 'email',
    name: '邮件 SMTP',
    isCore: true,
    isEnabled: (s) => Boolean(s.email.enabled),
    isConfigured: (s) =>
      Boolean(s.email.host.trim() && s.email.user.trim() && s.email.pass.trim() && s.email.adminTo.trim()),
    send: async (settings, ctx) => {
      const { email } = settings;
      const transporter = nodemailer.createTransport({
        host: email.host.trim(),
        port: Number(email.port) || 465,
        secure: Boolean(email.secure),
        auth: {
          user: email.user.trim(),
          pass: email.pass.trim(),
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });

      const amountYuan = centsToYuan(ctx.order.actualAmountCents);
      const chName = CHANNEL_META[ctx.order.channel].shortName;
      const subjectPrefix = ctx.isTest ? '[测试通知] ' : '';
      const subject = `${subjectPrefix}DoloPay 待核销 ¥${amountYuan} (${chName} · 口令 ${ctx.order.remarkCode})`;

      const safeTitle = escapeHtml(ctx.order.productTitle);
      const safePayer = escapeHtml(ctx.order.payerNickName || '匿名买家');
      const safeEmail = escapeHtml(ctx.order.payerEmail || '未填写');
      const safeMsg = escapeHtml(ctx.order.payerMessage || '无留言');
      const safeOrderId = escapeHtml(ctx.order.id);
      const safeRemark = escapeHtml(ctx.order.remarkCode);
      const safeUrl = escapeHtml(ctx.approvalUrl);

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC',sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8fafc;color:#0f172a;">
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
            <div style="font-size:13px;color:#64748b;margin-bottom:6px;">DoloPay 个人收款审批提醒</div>
            <div style="font-size:28px;font-weight:700;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">¥${amountYuan}</div>
            <div style="margin-top:6px;font-size:13px;color:#475569;">${escapeHtml(chName)} · 6位付款口令：<strong style="color:#2563eb;font-family:ui-monospace,monospace;">${safeRemark}</strong></div>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />
            <table style="width:100%;font-size:13px;line-height:1.7;color:#334155;">
              <tr><td style="color:#64748b;width:88px;">商品项目</td><td><strong>${safeTitle}</strong></td></tr>
              <tr><td style="color:#64748b;">订单编号</td><td style="font-family:ui-monospace,monospace;">${safeOrderId}</td></tr>
              <tr><td style="color:#64748b;">付款人</td><td>${safePayer} (${safeEmail})</td></tr>
              <tr><td style="color:#64748b;">买家留言</td><td>${safeMsg}</td></tr>
            </table>
            <div style="margin-top:22px;text-align:center;">
              <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">打开手机快捷审批页（核对后一键放行）</a>
            </div>
            <p style="margin-top:16px;font-size:12px;color:#94a3b8;word-break:break-all;">若按钮无法点击，请复制链接打开：${safeUrl}</p>
          </div>
        </div>
      `;

      const text = [
        `${subjectPrefix}DoloPay 收款待核销提醒`,
        `实付金额：¥${amountYuan} (${chName})`,
        `6位付款口令：${ctx.order.remarkCode}`,
        `商品：${ctx.order.productTitle}`,
        `订单号：${ctx.order.id}`,
        `买家：${ctx.order.payerNickName} (${ctx.order.payerEmail})`,
        `审批确认页：${ctx.approvalUrl}`,
      ].join('\n');

      const info = await transporter.sendMail({
        from: email.from.trim() || `"DoloPay 收款通知" <${email.user.trim()}>`,
        to: email.adminTo.trim(),
        subject,
        text,
        html,
      });

      return `邮件已投递至 ${email.adminTo.trim()} (MessageId: ${info.messageId})`;
    },
  },
  {
    id: 'feishu',
    name: '飞书机器人',
    isCore: true,
    isEnabled: (s) => Boolean(s.feishu.enabled),
    isConfigured: (s) => Boolean(s.feishu.webhookUrl.trim()),
    send: async (settings, ctx) => {
      const check = validateSafeOutboundUrl(settings.feishu.webhookUrl, [
        'open.feishu.cn',
        'open.larksuite.com',
      ]);
      if (!check.ok) throw new Error(check.error);

      const amountYuan = centsToYuan(ctx.order.actualAmountCents);
      const chName = CHANNEL_META[ctx.order.channel].shortName;
      const titlePrefix = ctx.isTest ? '【测试通知】' : '';

      const payload: Record<string, unknown> = {
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: {
            template: ctx.isTest ? 'blue' : 'orange',
            title: {
              tag: 'plain_text',
              content: `${titlePrefix}待核销收款 ¥${amountYuan} · ${chName}`,
            },
          },
          elements: [
            {
              tag: 'div',
              fields: [
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**实付金额**\n¥${amountYuan}` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**6位付款口令**\n\`${ctx.order.remarkCode}\`` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**收款渠道**\n${chName}` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**订单号**\n${ctx.order.id}` },
                },
              ],
            },
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `**商品项目**：${ctx.order.productTitle}\n**付款人**：${ctx.order.payerNickName} (${ctx.order.payerEmail || '未填邮箱'})\n**买家留言**：${ctx.order.payerMessage || '无'}`,
              },
            },
            { tag: 'hr' },
            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  type: 'primary',
                  text: { tag: 'plain_text', content: '打开快捷审批页（核对后一键通过/驳回）' },
                  url: ctx.approvalUrl,
                },
              ],
            },
          ],
        },
      };

      if (settings.feishu.secret.trim()) {
        const tsSec = String(Math.floor(Date.now() / 1000));
        payload.timestamp = tsSec;
        payload.sign = buildFeishuSignature(tsSec, settings.feishu.secret.trim());
      }

      const resp = await fetchWithTimeout(check.url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${bodyText.slice(0, 160)}`);
      }
      try {
        const json = JSON.parse(bodyText);
        if (json.code !== undefined && json.code !== 0) {
          throw new Error(`飞书返回错误 (${json.code}): ${json.msg || bodyText}`);
        }
        if (json.StatusCode !== undefined && json.StatusCode !== 0) {
          throw new Error(`飞书返回错误 (${json.StatusCode}): ${json.StatusMessage || bodyText}`);
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.startsWith('飞书返回错误')) {
          throw parseErr;
        }
      }
      return '飞书交互审批卡片推送成功';
    },
  },
  {
    id: 'dingtalk',
    name: '钉钉机器人',
    isCore: true,
    isEnabled: (s) => Boolean(s.dingtalk.enabled),
    isConfigured: (s) => Boolean(s.dingtalk.webhookUrl.trim()),
    send: async (settings, ctx) => {
      const check = validateSafeOutboundUrl(settings.dingtalk.webhookUrl, ['oapi.dingtalk.com']);
      if (!check.ok) throw new Error(check.error);

      const signedUrl = buildDingTalkSignedUrl(check.url.toString(), settings.dingtalk.secret);
      const amountYuan = centsToYuan(ctx.order.actualAmountCents);
      const chName = CHANNEL_META[ctx.order.channel].shortName;
      const titlePrefix = ctx.isTest ? '【测试通知】' : '';

      const payload = {
        msgtype: 'actionCard',
        actionCard: {
          title: `${titlePrefix}DoloPay 待核销 ¥${amountYuan}`,
          text: [
            `### ${titlePrefix}DoloPay 收款待核销提醒`,
            `- **实付金额**：¥${amountYuan}（${chName}）`,
            `- **6位付款口令**：\`${ctx.order.remarkCode}\``,
            `- **商品项目**：${ctx.order.productTitle}`,
            `- **订单编号**：${ctx.order.id}`,
            `- **付款人**：${ctx.order.payerNickName} (${ctx.order.payerEmail || '未填'})`,
            `- **留言**：${ctx.order.payerMessage || '无'}`,
            '',
            '请核对手机收款账单后点击下方按钮进入确认页。',
          ].join('\n\n'),
          btnOrientation: '0',
          singleTitle: '打开手机快捷审批页',
          singleURL: ctx.approvalUrl,
        },
      };

      const resp = await fetchWithTimeout(signedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${bodyText.slice(0, 160)}`);
      }
      const json = JSON.parse(bodyText);
      if (json.errcode !== 0) {
        throw new Error(`钉钉返回错误 (${json.errcode}): ${json.errmsg || bodyText}`);
      }
      return '钉钉 ActionCard 审批卡片推送成功';
    },
  },
  {
    id: 'bark',
    name: 'Bark iOS 扩展',
    isCore: false,
    isEnabled: (s) => Boolean(s.plugins.bark),
    isConfigured: (s) => Boolean(s.bark.pushUrl.trim()),
    send: async (settings, ctx) => {
      const check = validateSafeOutboundUrl(settings.bark.pushUrl);
      if (!check.ok) throw new Error(check.error);

      const amountYuan = centsToYuan(ctx.order.actualAmountCents);
      const chName = CHANNEL_META[ctx.order.channel].shortName;
      const resp = await fetchWithTimeout(check.url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${ctx.isTest ? '[测试] ' : ''}待核销 ¥${amountYuan} (${chName})`,
          body: `口令 ${ctx.order.remarkCode} · ${ctx.order.productTitle} · 点击前往一键审批`,
          group: settings.bark.group.trim() || 'DoloPay',
          url: ctx.approvalUrl,
        }),
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        throw new Error(`Bark HTTP ${resp.status}: ${bodyText.slice(0, 120)}`);
      }
      return 'Bark 强提醒推送成功';
    },
  },
  {
    id: 'telegram',
    name: 'Telegram Bot 扩展',
    isCore: false,
    isEnabled: (s) => Boolean(s.plugins.telegram),
    isConfigured: (s) => Boolean(s.telegram.botToken.trim() && s.telegram.chatId.trim()),
    send: async (settings, ctx) => {
      const token = settings.telegram.botToken.trim();
      const chatId = settings.telegram.chatId.trim();
      const endpoint = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
      const amountYuan = centsToYuan(ctx.order.actualAmountCents);
      const chName = CHANNEL_META[ctx.order.channel].shortName;

      const text = [
        `<b>${ctx.isTest ? '[测试] ' : ''}DoloPay 待核销收款 ¥${amountYuan}</b>`,
        `渠道：${escapeHtml(chName)}`,
        `口令：<code>${escapeHtml(ctx.order.remarkCode)}</code>`,
        `商品：${escapeHtml(ctx.order.productTitle)}`,
        `订单号：<code>${escapeHtml(ctx.order.id)}</code>`,
        `买家：${escapeHtml(ctx.order.payerNickName)} (${escapeHtml(ctx.order.payerEmail || '未填')})`,
      ].join('\n');

      const resp = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '打开手机快捷审批页', url: ctx.approvalUrl }]],
          },
        }),
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        throw new Error(`Telegram HTTP ${resp.status}: ${bodyText.slice(0, 160)}`);
      }
      const json = JSON.parse(bodyText);
      if (!json.ok) {
        throw new Error(`Telegram 返回错误: ${json.description || bodyText}`);
      }
      return 'Telegram Bot 审批消息推送成功';
    },
  },
];

/**
 * 并发向所有已启用且配置完整的审批通道派发通知（默认支持 邮件 + 飞书 + 钉钉 多渠道同时推送）
 */
export async function dispatchApprovalNotifications(
  settings: GatewaySettings,
  ctx: ApprovalNotificationContext
): Promise<NotificationDeliveryLog[]> {
  const activePlugins = NOTIFIER_PLUGINS.filter((p) => p.isEnabled(settings));
  if (activePlugins.length === 0) {
    return [
      {
        channel: 'email',
        channelName: '审批通知',
        ok: true,
        skipped: true,
        message: '当前未开启任何审批通道，请前往管理后台核销或开启邮件/飞书/钉钉通知',
        sentAt: Date.now(),
      },
    ];
  }

  const settled = await Promise.all(
    activePlugins.map(async (plugin): Promise<NotificationDeliveryLog> => {
      const now = Date.now();
      if (!plugin.isConfigured(settings)) {
        return {
          channel: plugin.id,
          channelName: plugin.name,
          ok: true,
          skipped: true,
          message: `已开启但尚未填写配置参数（可在「审批与接入」页或 .env 补全）`,
          sentAt: now,
        };
      }
      try {
        const msg = await plugin.send(settings, ctx);
        return {
          channel: plugin.id,
          channelName: plugin.name,
          ok: true,
          message: msg,
          sentAt: Date.now(),
        };
      } catch (err) {
        return {
          channel: plugin.id,
          channelName: plugin.name,
          ok: false,
          message: err instanceof Error ? err.message : '发送失败',
          sentAt: Date.now(),
        };
      }
    })
  );

  return settled;
}

export async function sendSingleTestNotification(
  channelId: ApprovalNotifierId,
  settings: GatewaySettings,
  approvalUrl: string
): Promise<{ ok: boolean; message: string }> {
  const plugin = NOTIFIER_PLUGINS.find((p) => p.id === channelId);
  if (!plugin) {
    return { ok: false, message: `未知通知通道: ${channelId}` };
  }
  if (!plugin.isConfigured(settings)) {
    return { ok: false, message: `请先填写完整的 ${plugin.name} 配置参数并保存后再测试` };
  }
  const now = Date.now();
  const sampleOrder: DoloPayOrder = {
    id: `DP_TEST_${String(now).slice(-6)}`,
    outTradeNo: 'TEST_PING',
    productTitle: 'DoloPay 审批通道连通性测试',
    channel: 'alipay',
    nominalAmountCents: 100,
    actualAmountCents: 100,
    remarkCode: '888666',
    payerNickName: '测试买家',
    payerEmail: 'test@example.com',
    payerMessage: '如果您看到这条消息，说明当前审批通道已配置成功！',
    clientIp: '127.0.0.1',
    status: 'AWAITING_APPROVAL',
    createdAt: now,
    expiresAt: now + 900_000,
    approvalToken: 'test_preview',
    notificationLogs: [],
    webhookStatus: 'IDLE',
    webhookAttempts: 0,
  };
  try {
    const msg = await plugin.send(settings, {
      order: sampleOrder,
      approvalUrl,
      isTest: true,
    });
    return { ok: true, message: msg };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '测试发送失败，请检查配置参数与网络连通性',
    };
  }
}

/**
 * 核销后可选发送买家收款确认回执邮件
 */
export async function sendBuyerReceiptEmailIfConfigured(
  settings: GatewaySettings,
  order: DoloPayOrder
): Promise<void> {
  const { email } = settings;
  if (
    !email.enabled ||
    !email.sendBuyerReceipt ||
    !order.payerEmail ||
    !order.payerEmail.includes('@') ||
    !email.host.trim() ||
    !email.user.trim() ||
    !email.pass.trim()
  ) {
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: email.host.trim(),
      port: Number(email.port) || 465,
      secure: Boolean(email.secure),
      auth: { user: email.user.trim(), pass: email.pass.trim() },
      connectionTimeout: 8000,
    });
    const amountYuan = centsToYuan(order.actualAmountCents);
    await transporter.sendMail({
      from: email.from.trim() || `"${settings.siteTitle}" <${email.user.trim()}>`,
      to: order.payerEmail,
      subject: `收款已确认 · ${order.productTitle} (¥${amountYuan})`,
      text: `您好 ${order.payerNickName}，您的订单 ${order.id}（${order.productTitle}，实付 ¥${amountYuan}）已核销确认入账，感谢支持！`,
    });
  } catch (err) {
    console.warn('[DoloPay] Buyer receipt email failed:', err);
  }
}

/**
 * 核销成功后向下游业务系统 notifyUrl 派发真实签名异步回调
 */
export async function dispatchMerchantWebhook(params: {
  order: DoloPayOrder;
  connectedApp?: ConnectedApp;
  fallbackSecretKey: string;
  nowMs: number;
}): Promise<{ status: 'DELIVERED' | 'FAILED' | 'SKIPPED'; responseText: string }> {
  const targetUrl = (params.order.notifyUrl || params.connectedApp?.notifyUrl || '').trim();
  if (!targetUrl) {
    return { status: 'SKIPPED', responseText: '未配置下游回调 notifyUrl，已跳过回调' };
  }

  const check = validateSafeOutboundUrl(targetUrl);
  if (!check.ok) {
    return { status: 'FAILED', responseText: `回调地址未通过安全校验: ${check.error}` };
  }

  const envelope = buildMerchantWebhookEnvelope({
    order: params.order,
    connectedApp: params.connectedApp,
    fallbackCallbackUrl: targetUrl,
    fallbackSecretKey: params.fallbackSecretKey,
    nowMs: params.nowMs,
  });

  try {
    const isForm = envelope.headers['Content-Type'] === 'application/x-www-form-urlencoded';
    const bodyStr = isForm
      ? new URLSearchParams(
          Object.entries(envelope.body).map(([k, v]) => [k, String(v)])
        ).toString()
      : JSON.stringify(envelope.body);

    const resp = await fetchWithTimeout(check.url.toString(), {
      method: 'POST',
      headers: envelope.headers,
      body: bodyStr,
    });
    const text = (await resp.text()).slice(0, 180);
    if (resp.ok) {
      return {
        status: 'DELIVERED',
        responseText: `HTTP ${resp.status} · ${text || 'OK'}`,
      };
    }
    return {
      status: 'FAILED',
      responseText: `HTTP ${resp.status} · ${text || 'Callback rejected'}`,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      responseText: err instanceof Error ? err.message : '回调请求超时或网络异常',
    };
  }
}

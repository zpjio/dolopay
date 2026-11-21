/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  allocatePayableAmount,
  calculateDashboardMetrics,
  centsToYuan,
  checkSlidingWindowRateLimit,
  computeCanonicalOpenApiSign,
  constantTimeEqual,
  isOrderApprovalTokenValid,
  processWebhookNotification,
  signAdminSessionToken,
  signOrderApprovalToken,
  sweepExpiredOrders,
  verifyAdminSessionToken,
  yuanToCents,
  type ApprovalNotifierId,
  type ConnectedApp,
  type DoloPayOrder,
  type FloatStrategy,
  type GatewaySettings,
  type IntegrationProtocol,
  type PaymentChannel,
  type QrChannelSlot,
  type SecurityAuditEvent,
  type SettlementMethod,
} from './src/core/dolopayEngine';
import {
  OPTIONAL_PLUGIN_REGISTRY,
  resolvePluginStates,
  type PluginStates,
} from './src/core/pluginRegistry';
import {
  CHANNEL_META,
  createInitialAuditLogs,
  createInitialConnectedApps,
  createInitialGatewaySettings,
  createInitialOrders,
  createInitialQrSlots,
} from './src/core/seedData';
import {
  dispatchApprovalNotifications,
  dispatchMerchantWebhook,
  sendBuyerReceiptEmailIfConfigured,
  sendSingleTestNotification,
} from './src/server/notifiers';
import {
  generateSecureSecret,
  hashAdminPassword,
  parseAndValidateQrImageDataUrl,
  resolveConfinedPath,
  sanitizeOriginFromHeaders,
  validateSafeHttpUrl,
  validateSafeOutboundUrl,
  verifyAdminPasswordHash,
  type StoredPasswordHash,
} from './src/server/security';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const UPLOADED_QR_DIR = path.resolve(DATA_DIR, 'qrcodes');
const STATIC_QR_DIR = path.resolve(process.cwd(), 'public', 'qrcodes');
const STATE_FILE = path.resolve(DATA_DIR, 'dolopay-state.json');

interface PersistedGatewayState {
  adminPasswordHash: StoredPasswordHash | null;
  sessionSecret: string;
  approvalSecret: string;
  trustedAdminOrigin?: string;
  settings: GatewaySettings;
  qrSlots: Record<PaymentChannel, QrChannelSlot>;
  connectedApps: ConnectedApp[];
  orders: DoloPayOrder[];
  securityAuditLogs: SecurityAuditEvent[];
}

function ensureDirectories() {
  for (const dir of [DATA_DIR, UPLOADED_QR_DIR, STATIC_QR_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirectories();

// Initialize state with defaults + env overrides
let adminPasswordHash: StoredPasswordHash | null = null;
let sessionSecret =
  process.env.DOLOPAY_SESSION_SECRET?.trim() || generateSecureSecret('dpsess', 24);
let approvalSecret =
  process.env.DOLOPAY_APPROVAL_SECRET?.trim() || generateSecureSecret('dpappr', 24);
const defaultAndroidSecret =
  process.env.DOLOPAY_ANDROID_SECRET?.trim() || generateSecureSecret('dpand', 16);
const defaultAppSecret = generateSecureSecret('sec', 16);

const initialEnvOriginCheck = validateSafeHttpUrl(
  process.env.PUBLIC_BASE_URL || process.env.APP_URL || ''
);
let trustedAdminOrigin: string = initialEnvOriginCheck.ok
  ? initialEnvOriginCheck.origin
  : `http://localhost:${PORT}`;

const bootNowMs = Date.now();
let serverSettings: GatewaySettings = createInitialGatewaySettings({
  androidWebhookSecret: defaultAndroidSecret,
  publicBaseUrl: initialEnvOriginCheck.ok ? initialEnvOriginCheck.origin : '',
});
let serverQrSlots: Record<PaymentChannel, QrChannelSlot> = createInitialQrSlots(bootNowMs);
let serverConnectedApps: ConnectedApp[] = createInitialConnectedApps(bootNowMs, defaultAppSecret);
let serverOrders: DoloPayOrder[] = createInitialOrders(bootNowMs, approvalSecret);
let securityAuditLogs: SecurityAuditEvent[] = createInitialAuditLogs(bootNowMs);

const ipOrderRateLimitBuckets = new Map<string, number[]>();
const ipLoginRateLimitBuckets = new Map<string, number[]>();
const ipWebhookRateLimitBuckets = new Map<string, number[]>();
const ipMarkPaidRateLimitBuckets = new Map<string, number[]>();
const ipApprovalRateLimitBuckets = new Map<string, number[]>();

function applyEnvOverridesToSettings(base: GatewaySettings): GatewaySettings {
  const next: GatewaySettings = structuredClone(base);

  if (process.env.PUBLIC_BASE_URL?.trim()) {
    const check = validateSafeHttpUrl(process.env.PUBLIC_BASE_URL.trim());
    if (check.ok) {
      next.publicBaseUrl = check.origin;
    }
  } else if (!next.publicBaseUrl && process.env.APP_URL?.trim()) {
    const check = validateSafeHttpUrl(process.env.APP_URL.trim());
    if (check.ok) {
      next.publicBaseUrl = check.origin;
    }
  }

  // SMTP Email env overrides
  if (process.env.SMTP_HOST?.trim()) {
    next.email.host = process.env.SMTP_HOST.trim();
    next.email.enabled = true;
  }
  if (process.env.SMTP_PORT?.trim()) {
    const p = Number(process.env.SMTP_PORT.trim());
    if (Number.isFinite(p) && p > 0) {
      next.email.port = p;
      next.email.secure = p === 465;
    }
  }
  if (process.env.SMTP_USER?.trim()) next.email.user = process.env.SMTP_USER.trim();
  if (process.env.SMTP_PASS?.trim()) next.email.pass = process.env.SMTP_PASS.trim();
  if (process.env.SMTP_FROM?.trim()) next.email.from = process.env.SMTP_FROM.trim();
  if (process.env.ADMIN_EMAIL?.trim()) next.email.adminTo = process.env.ADMIN_EMAIL.trim();

  // Feishu env overrides
  if (process.env.FEISHU_WEBHOOK_URL?.trim()) {
    next.feishu.webhookUrl = process.env.FEISHU_WEBHOOK_URL.trim();
    next.feishu.enabled = true;
  }
  if (process.env.FEISHU_SECRET?.trim()) {
    next.feishu.secret = process.env.FEISHU_SECRET.trim();
  }

  // DingTalk env overrides
  if (process.env.DINGTALK_WEBHOOK_URL?.trim()) {
    next.dingtalk.webhookUrl = process.env.DINGTALK_WEBHOOK_URL.trim();
    next.dingtalk.enabled = true;
  }
  if (process.env.DINGTALK_SECRET?.trim()) {
    next.dingtalk.secret = process.env.DINGTALK_SECRET.trim();
  }

  // Optional plugins env overrides
  if (process.env.BARK_PUSH_URL?.trim()) next.bark.pushUrl = process.env.BARK_PUSH_URL.trim();
  if (process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    next.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN.trim();
  }
  if (process.env.TELEGRAM_CHAT_ID?.trim()) {
    next.telegram.chatId = process.env.TELEGRAM_CHAT_ID.trim();
  }
  if (process.env.DOLOPAY_ANDROID_SECRET?.trim()) {
    next.androidWebhookSecret = process.env.DOLOPAY_ANDROID_SECRET.trim();
  }

  const resolvedPlugins = resolvePluginStates(
    next.plugins,
    process.env.DOLOPAY_ENABLED_PLUGINS,
    process.env.DOLOPAY_DISABLED_PLUGINS
  );
  next.plugins = resolvedPlugins.states;
  return next;
}

function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedGatewayState>;

      if (parsed.adminPasswordHash?.salt && parsed.adminPasswordHash?.hash) {
        adminPasswordHash = parsed.adminPasswordHash;
      }
      if (parsed.sessionSecret && !process.env.DOLOPAY_SESSION_SECRET?.trim()) {
        sessionSecret = parsed.sessionSecret;
      }
      if (parsed.approvalSecret && !process.env.DOLOPAY_APPROVAL_SECRET?.trim()) {
        approvalSecret = parsed.approvalSecret;
      }
      if (parsed.trustedAdminOrigin) {
        const originCheck = validateSafeHttpUrl(parsed.trustedAdminOrigin);
        if (originCheck.ok) {
          trustedAdminOrigin = originCheck.origin;
        }
      }
      if (parsed.settings) {
        const defaults = createInitialGatewaySettings({
          androidWebhookSecret: defaultAndroidSecret,
        });
        serverSettings = {
          ...defaults,
          ...parsed.settings,
          email: { ...defaults.email, ...(parsed.settings.email || {}) },
          feishu: { ...defaults.feishu, ...(parsed.settings.feishu || {}) },
          dingtalk: { ...defaults.dingtalk, ...(parsed.settings.dingtalk || {}) },
          bark: { ...defaults.bark, ...(parsed.settings.bark || {}) },
          telegram: { ...defaults.telegram, ...(parsed.settings.telegram || {}) },
          plugins: { ...defaults.plugins, ...(parsed.settings.plugins || {}) },
        };
      }
      if (parsed.qrSlots) {
        const defaultSlots = createInitialQrSlots(Date.now());
        serverQrSlots = {
          alipay: { ...defaultSlots.alipay, ...(parsed.qrSlots.alipay || {}) },
          wechat: { ...defaultSlots.wechat, ...(parsed.qrSlots.wechat || {}) },
          unionpay: { ...defaultSlots.unionpay, ...(parsed.qrSlots.unionpay || {}) },
        };
      }
      if (Array.isArray(parsed.connectedApps) && parsed.connectedApps.length > 0) {
        serverConnectedApps = parsed.connectedApps;
      }
      if (Array.isArray(parsed.orders)) {
        serverOrders = parsed.orders;
      }
      if (Array.isArray(parsed.securityAuditLogs)) {
        securityAuditLogs = parsed.securityAuditLogs.slice(0, 100);
      }
    }
  } catch (err) {
    console.warn('[DoloPay] Failed to load persisted state, using fresh defaults:', err);
  }

  // Always apply environment overrides
  if (process.env.DOLOPAY_ADMIN_PASSWORD?.trim() && !adminPasswordHash) {
    adminPasswordHash = hashAdminPassword(process.env.DOLOPAY_ADMIN_PASSWORD.trim());
  }
  serverSettings = applyEnvOverridesToSettings(serverSettings);

  // Ensure every order has a valid approval token
  const now = Date.now();
  serverOrders = serverOrders.map((o) => {
    if (!o.approvalToken || !o.approvalToken.startsWith('dpap_')) {
      return {
        ...o,
        approvalToken: signOrderApprovalToken(o.id, o.createdAt || now, now + 7 * 86400_000, approvalSecret),
        notificationLogs: Array.isArray(o.notificationLogs) ? o.notificationLogs : [],
      };
    }
    return {
      ...o,
      notificationLogs: Array.isArray(o.notificationLogs) ? o.notificationLogs : [],
    };
  });
}

function savePersistedState() {
  try {
    ensureDirectories();
    const payload: PersistedGatewayState = {
      adminPasswordHash,
      sessionSecret,
      approvalSecret,
      trustedAdminOrigin,
      settings: serverSettings,
      qrSlots: serverQrSlots,
      connectedApps: serverConnectedApps,
      orders: serverOrders.slice(0, 500),
      securityAuditLogs: securityAuditLogs.slice(0, 100),
    };
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.warn('[DoloPay] Failed to save persisted state:', err);
  }
}

loadPersistedState();
savePersistedState();

function appendAuditLog(
  level: SecurityAuditEvent['level'],
  eventType: SecurityAuditEvent['eventType'],
  clientIp: string,
  summary: string
) {
  const now = Date.now();
  securityAuditLogs = [
    {
      id: `sec_${now}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      level,
      eventType,
      clientIp,
      summary,
    },
    ...securityAuditLogs,
  ].slice(0, 100);
}

function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim() !== '') {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * 仅在经过认证的管理员请求中更新受信任站点 Origin
 */
function recordTrustedAdminOriginFromRequest(req: Request) {
  const protoHeader =
    (typeof req.headers['x-forwarded-proto'] === 'string' && req.headers['x-forwarded-proto']) ||
    req.protocol ||
    'http';
  const hostHeader =
    (typeof req.headers['x-forwarded-host'] === 'string' && req.headers['x-forwarded-host']) ||
    req.headers.host;

  const sanitized = sanitizeOriginFromHeaders(protoHeader, hostHeader);
  if (sanitized && sanitized !== trustedAdminOrigin) {
    trustedAdminOrigin = sanitized;
  }
}

/**
 * 解析用于发送给管理员的审批链接 Base URL（防御 Host Header Poisoning，绝不采信未认证买家请求的 X-Forwarded-Host）
 */
function resolveTrustedPublicBaseUrl(): string {
  if (serverSettings.publicBaseUrl?.trim()) {
    const check = validateSafeHttpUrl(serverSettings.publicBaseUrl.trim());
    if (check.ok) {
      return check.origin;
    }
  }
  const envUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').trim();
  if (envUrl) {
    const check = validateSafeHttpUrl(envUrl);
    if (check.ok) {
      return check.origin;
    }
  }
  return trustedAdminOrigin || `http://localhost:${PORT}`;
}

function buildOrderApprovalUrl(baseUrl: string, order: DoloPayOrder): string {
  return `${baseUrl}/approve?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(
    order.approvalToken
  )}`;
}

/**
 * 解析某渠道的收款码图片来源：
 * 1. 优先读取后台上传的原图 (.data/qrcodes/<channel>.<ext>)
 * 2. 其次读取开发者放入本地目录的静态图片 (public/qrcodes/<channel>.<ext>)
 */
function resolveQrChannelImageFile(channel: PaymentChannel): {
  exists: boolean;
  source: 'uploaded' | 'static' | 'none';
  filePath?: string;
  mime?: string;
  updatedAtMs: number;
} {
  const slot = serverQrSlots[channel];
  const exts: Array<{ ext: string; mime: string }> = [
    { ext: 'png', mime: 'image/png' },
    { ext: 'jpg', mime: 'image/jpeg' },
    { ext: 'jpeg', mime: 'image/jpeg' },
    { ext: 'webp', mime: 'image/webp' },
  ];

  // 1. Check uploaded file in .data/qrcodes/
  if (slot?.uploadedFileName) {
    const confined = resolveConfinedPath(UPLOADED_QR_DIR, slot.uploadedFileName);
    if (confined && fs.existsSync(confined)) {
      const ext = path.extname(confined).replace('.', '').toLowerCase();
      const mime = exts.find((e) => e.ext === ext)?.mime || 'image/png';
      const stat = fs.statSync(confined);
      return {
        exists: true,
        source: 'uploaded',
        filePath: confined,
        mime,
        updatedAtMs: Math.round(stat.mtimeMs),
      };
    }
  }

  for (const item of exts) {
    const candidate = resolveConfinedPath(UPLOADED_QR_DIR, `${channel}.${item.ext}`);
    if (candidate && fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      return {
        exists: true,
        source: 'uploaded',
        filePath: candidate,
        mime: item.mime,
        updatedAtMs: Math.round(stat.mtimeMs),
      };
    }
  }

  // 2. Check static drop-in directory public/qrcodes/
  for (const item of exts) {
    const candidate = resolveConfinedPath(STATIC_QR_DIR, `${channel}.${item.ext}`);
    if (candidate && fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      return {
        exists: true,
        source: 'static',
        filePath: candidate,
        mime: item.mime,
        updatedAtMs: Math.round(stat.mtimeMs),
      };
    }
  }

  return {
    exists: false,
    source: 'none',
    updatedAtMs: slot?.updatedAt || 0,
  };
}

function buildQrSlotsStatusForClient(): Record<
  PaymentChannel,
  QrChannelSlot & {
    hasImage: boolean;
    imageSource: 'uploaded' | 'static' | 'none';
    imageUrl: string | null;
  }
> {
  const channels: PaymentChannel[] = ['alipay', 'wechat', 'unionpay'];
  const result = {} as Record<
    PaymentChannel,
    QrChannelSlot & {
      hasImage: boolean;
      imageSource: 'uploaded' | 'static' | 'none';
      imageUrl: string | null;
    }
  >;

  for (const ch of channels) {
    const slot = serverQrSlots[ch];
    const resolved = resolveQrChannelImageFile(ch);
    result[ch] = {
      ...slot,
      hasImage: resolved.exists,
      imageSource: resolved.source,
      imageUrl: resolved.exists ? `/api/v1/public/qrcode/${ch}?v=${resolved.updatedAtMs}` : null,
    };
  }
  return result;
}

function getEnabledChannels(): PaymentChannel[] {
  const base: PaymentChannel[] = ['alipay', 'wechat'];
  if (serverSettings.plugins.unionpay) {
    base.push('unionpay');
  }
  return base.filter((ch) => serverQrSlots[ch]?.enabled !== false);
}

function generate6DigitRemarkCode(existingOrders: DoloPayOrder[], nowMs: number): string {
  const activeCodes = new Set(
    existingOrders
      .filter((o) => o.status === 'PENDING_PAYMENT' || o.status === 'AWAITING_APPROVAL')
      .map((o) => o.remarkCode)
  );
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 999999));
    if (!activeCodes.has(code)) return code;
  }
  return String(nowMs).slice(-6);
}

function extractAdminToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const tokenHeader = req.headers['x-dolopay-admin-token'];
  if (typeof tokenHeader === 'string' && tokenHeader.trim() !== '') {
    return tokenHeader.trim();
  }
  return null;
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!adminPasswordHash) {
    return res.status(403).json({
      code: 403,
      errorCode: 'ADMIN_NOT_INITIALIZED',
      msg: '请先设置管理后台初始访问密码',
    });
  }
  const token = extractAdminToken(req);
  if (!verifyAdminSessionToken(token, 'dolopay_admin', sessionSecret, Date.now())) {
    return res.status(401).json({
      code: 401,
      errorCode: 'ADMIN_UNAUTHORIZED',
      msg: '管理员会话未登录或已过期，请验证密码',
    });
  }
  recordTrustedAdminOriginFromRequest(req);
  next();
}

async function settleAndApproveOrder(params: {
  order: DoloPayOrder;
  settlementMethod: SettlementMethod;
  clientIp: string;
}): Promise<DoloPayOrder> {
  const nowMs = Date.now();
  const { order, settlementMethod, clientIp } = params;

  const updatedOrder: DoloPayOrder = {
    ...order,
    status: 'PAID',
    paidAt: nowMs,
    settlementMethod,
  };

  const connectedApp = serverConnectedApps.find((a) => a.appId === order.appId);
  const webhookResult = await dispatchMerchantWebhook({
    order: updatedOrder,
    connectedApp,
    fallbackSecretKey: connectedApp?.appSecret || sessionSecret,
    nowMs,
  });

  updatedOrder.webhookStatus = webhookResult.status;
  updatedOrder.webhookAttempts = (order.webhookAttempts || 0) + 1;
  updatedOrder.webhookLastResponse = webhookResult.responseText;

  serverOrders = serverOrders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));

  if (connectedApp && order.status !== 'PAID') {
    serverConnectedApps = serverConnectedApps.map((a) =>
      a.id === connectedApp.id
        ? {
            ...a,
            totalOrders: a.totalOrders + 1,
            totalPaidCents: a.totalPaidCents + updatedOrder.actualAmountCents,
          }
        : a
    );
  }

  appendAuditLog(
    'INFO',
    'ORDER_APPROVED',
    clientIp,
    `订单 ${updatedOrder.id} (¥${centsToYuan(updatedOrder.actualAmountCents)} · 口令 ${updatedOrder.remarkCode}) 已核销放行 [${settlementMethod}]`
  );
  savePersistedState();

  void sendBuyerReceiptEmailIfConfigured(serverSettings, updatedOrder);
  return updatedOrder;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Background sweep of expired pending orders every 5s
  setInterval(() => {
    const { updatedOrders, expiredOrderIds } = sweepExpiredOrders(serverOrders, Date.now());
    if (expiredOrderIds.length > 0) {
      serverOrders = updatedOrders;
      savePersistedState();
    }
  }, 5000);

  // =========================================================================
  // 1. Public Health & Cashier Configuration APIs
  // =========================================================================
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'DoloPay Indie Personal Payment Gateway',
      version: '3.2.0',
    });
  });

  app.get(['/api/v1/public/config', '/api/v1/public/cashier-config'], (_req, res) => {
    const qrStatus = buildQrSlotsStatusForClient();
    const enabledChannels = getEnabledChannels();
    const enabledNotifiers: string[] = [];
    if (serverSettings.email.enabled) enabledNotifiers.push('邮件');
    if (serverSettings.feishu.enabled) enabledNotifiers.push('飞书');
    if (serverSettings.dingtalk.enabled) enabledNotifiers.push('钉钉');
    if (serverSettings.plugins.bark) enabledNotifiers.push('Bark');
    if (serverSettings.plugins.telegram) enabledNotifiers.push('Telegram');

    res.json({
      code: 0,
      data: {
        siteTitle: serverSettings.siteTitle,
        orderTtlSeconds: serverSettings.orderTtlSeconds,
        centFloatEnabled: Boolean(serverSettings.plugins.centFloat),
        channels: enabledChannels,
        enabledNotifiers,
        qrSlots: {
          alipay: {
            enabled: qrStatus.alipay.enabled,
            displayName: qrStatus.alipay.displayName,
            accountMask: qrStatus.alipay.accountMask,
            paymentTip: qrStatus.alipay.paymentTip,
            hasImage: qrStatus.alipay.hasImage,
            imageSource: qrStatus.alipay.imageSource,
            imageUrl: qrStatus.alipay.imageUrl,
          },
          wechat: {
            enabled: qrStatus.wechat.enabled,
            displayName: qrStatus.wechat.displayName,
            accountMask: qrStatus.wechat.accountMask,
            paymentTip: qrStatus.wechat.paymentTip,
            hasImage: qrStatus.wechat.hasImage,
            imageSource: qrStatus.wechat.imageSource,
            imageUrl: qrStatus.wechat.imageUrl,
          },
          ...(serverSettings.plugins.unionpay
            ? {
                unionpay: {
                  enabled: qrStatus.unionpay.enabled,
                  displayName: qrStatus.unionpay.displayName,
                  accountMask: qrStatus.unionpay.accountMask,
                  paymentTip: qrStatus.unionpay.paymentTip,
                  hasImage: qrStatus.unionpay.hasImage,
                  imageSource: qrStatus.unionpay.imageSource,
                  imageUrl: qrStatus.unionpay.imageUrl,
                },
              }
            : {}),
        },
      },
    });
  });

  // Serve Personal QR Code Image (uploaded or static drop-in)
  app.get('/api/v1/public/qrcode/:channel', (req, res) => {
    const channel = req.params.channel as PaymentChannel;
    if (!['alipay', 'wechat', 'unionpay'].includes(channel)) {
      return res.status(400).send('Invalid payment channel');
    }
    const resolved = resolveQrChannelImageFile(channel);
    if (!resolved.exists || !resolved.filePath) {
      return res.status(404).json({
        code: 404,
        msg: `尚未上传 ${CHANNEL_META[channel].shortName} 个人收款码图片`,
      });
    }
    res.setHeader('Content-Type', resolved.mime || 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(resolved.filePath);
  });

  // =========================================================================
  // 2. Public Cashier Order Creation, Polling & Buyer "I Have Paid" Trigger
  // =========================================================================
  app.post('/api/v1/public/orders', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);

    const { updatedOrders } = sweepExpiredOrders(serverOrders, nowMs);
    serverOrders = updatedOrders;

    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipOrderRateLimitBuckets,
      clientIp,
      limitPerMinute: serverSettings.rateLimitPerMinute,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        code: 429,
        msg: `请求过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
      });
    }

    const { productTitle, amount, channel, payerNickName, payerEmail, payerMessage } =
      req.body || {};
    const validChannels = getEnabledChannels();
    const targetChannel: PaymentChannel = validChannels.includes(channel)
      ? channel
      : validChannels[0] || 'alipay';

    const nominalCents = yuanToCents(amount);
    const alloc = allocatePayableAmount({
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      clientIp,
      existingOrders: serverOrders,
      maxPendingPerIp: serverSettings.maxPendingPerIp,
      enableCentFloat: Boolean(serverSettings.plugins.centFloat),
      floatStrategy: serverSettings.floatStrategy,
      maxFloatSteps: serverSettings.maxFloatSteps,
      nowMs,
    });

    if (!alloc.ok || !alloc.actualAmountCents) {
      return res.status(400).json({
        code: 400,
        errorCode: alloc.errorCode,
        msg: alloc.errorMessage,
      });
    }

    const orderId = `DP${nowMs.toString().slice(-8)}${crypto.randomInt(10, 99)}`;
    const remarkCode = generate6DigitRemarkCode(serverOrders, nowMs);
    const expiresAt = nowMs + serverSettings.orderTtlSeconds * 1000;
    const approvalToken = signOrderApprovalToken(
      orderId,
      nowMs,
      nowMs + 7 * 86400_000,
      approvalSecret
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: `CASHIER_${orderId}`,
      appId: serverConnectedApps[0]?.appId || 'dolopay_main',
      appName: serverConnectedApps[0]?.name || '个人收银台',
      protocol: 'DOLOPAY_REST_V1',
      productTitle: String(productTitle || '个人收款项目').trim().slice(0, 80),
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: String(payerNickName || '匿名买家').trim().slice(0, 40),
      payerEmail: String(payerEmail || '').trim().slice(0, 80),
      payerMessage: String(payerMessage || '').trim().slice(0, 140),
      clientIp,
      status: 'PENDING_PAYMENT',
      createdAt: nowMs,
      expiresAt,
      approvalToken,
      notificationLogs: [],
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    serverOrders = [newOrder, ...serverOrders];
    savePersistedState();

    const qrInfo = buildQrSlotsStatusForClient()[targetChannel];

    return res.status(201).json({
      code: 0,
      data: {
        orderId: newOrder.id,
        outTradeNo: newOrder.outTradeNo,
        productTitle: newOrder.productTitle,
        channel: newOrder.channel,
        nominalAmountCents: newOrder.nominalAmountCents,
        actualAmountCents: newOrder.actualAmountCents,
        nominalAmountYuan: centsToYuan(newOrder.nominalAmountCents),
        actualAmountYuan: centsToYuan(newOrder.actualAmountCents),
        remarkCode: newOrder.remarkCode,
        status: newOrder.status,
        expiresAt: newOrder.expiresAt,
        qrCode: {
          hasImage: qrInfo.hasImage,
          imageUrl: qrInfo.imageUrl,
          displayName: qrInfo.displayName,
          accountMask: qrInfo.accountMask,
          paymentTip: qrInfo.paymentTip,
        },
      },
    });
  });

  // Public Order Status Polling (Sanitized: never exposes approvalToken or admin secrets)
  app.get('/api/v1/orders/:id/status', (req, res) => {
    const nowMs = Date.now();
    const { updatedOrders } = sweepExpiredOrders(serverOrders, nowMs);
    serverOrders = updatedOrders;

    const order = serverOrders.find(
      (o) => o.id === req.params.id || o.outTradeNo === req.params.id
    );
    if (!order) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }

    const qrInfo = buildQrSlotsStatusForClient()[order.channel];
    const safeReturnUrl =
      order.returnUrl && validateSafeHttpUrl(order.returnUrl).ok ? order.returnUrl : undefined;

    return res.json({
      code: 0,
      data: {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        productTitle: order.productTitle,
        channel: order.channel,
        nominalAmountCents: order.nominalAmountCents,
        actualAmountCents: order.actualAmountCents,
        nominalAmountYuan: centsToYuan(order.nominalAmountCents),
        actualAmountYuan: centsToYuan(order.actualAmountCents),
        remarkCode: order.remarkCode,
        status: order.status,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt,
        paidAt: order.paidAt,
        returnUrl: safeReturnUrl,
        qrCode: {
          hasImage: qrInfo.hasImage,
          imageUrl: qrInfo.imageUrl,
          displayName: qrInfo.displayName,
          accountMask: qrInfo.accountMask,
          paymentTip: qrInfo.paymentTip,
        },
      },
    });
  });

  // Buyer clicks "我已支付，通知站长核销" -> Triggers Email / Feishu / DingTalk notifications
  app.post('/api/v1/orders/:id/mark-paid', async (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);

    // Rate limit mark-paid per IP
    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipMarkPaidRateLimitBuckets,
      clientIp,
      limitPerMinute: 10,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        code: 429,
        msg: `提醒过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
      });
    }

    const { updatedOrders } = sweepExpiredOrders(serverOrders, nowMs);
    serverOrders = updatedOrders;

    const target = serverOrders.find((o) => o.id === req.params.id);
    if (!target) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    if (target.status === 'PAID') {
      return res.json({
        code: 0,
        msg: '该订单已核销通过',
        data: { orderId: target.id, status: target.status },
      });
    }
    if (target.status === 'EXPIRED' || target.status === 'REJECTED') {
      return res.status(400).json({
        code: 400,
        msg: `当前订单状态 (${target.status}) 无法提交付款确认`,
      });
    }
    if (target.status === 'PENDING_PAYMENT' && target.expiresAt <= nowMs) {
      return res.status(400).json({
        code: 400,
        msg: '该收款单已超时过期，请重新发起收款单',
      });
    }

    // Per-order notification cooldown (60 seconds between notifications, max 3 pushes per order)
    const currentNotifyCount = target.notifyCount || 0;
    if (currentNotifyCount >= 3) {
      return res.status(429).json({
        code: 429,
        msg: '该订单已多次发送核销提醒，请耐心等待站长核对处理',
      });
    }
    if (target.lastNotifiedAt && nowMs - target.lastNotifiedAt < 60_000) {
      const waitSec = Math.max(1, Math.ceil((60_000 - (nowMs - target.lastNotifiedAt)) / 1000));
      return res.status(429).json({
        code: 429,
        msg: `已发送核销提醒，请勿重复点击（${waitSec} 秒后可再次提醒）`,
      });
    }

    // Security: Always use trusted public base URL (never trust buyer's X-Forwarded-Host header)
    const baseUrl = resolveTrustedPublicBaseUrl();
    const approvalUrl = buildOrderApprovalUrl(baseUrl, target);

    const updatedOrder: DoloPayOrder = {
      ...target,
      status: 'AWAITING_APPROVAL',
      expiresAt: Math.max(target.expiresAt, nowMs + 600_000),
      lastNotifiedAt: nowMs,
      notifyCount: currentNotifyCount + 1,
    };

    const logs = await dispatchApprovalNotifications(serverSettings, {
      order: updatedOrder,
      approvalUrl,
    });
    updatedOrder.notificationLogs = [...logs, ...(target.notificationLogs || [])].slice(0, 15);

    serverOrders = serverOrders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
    const deliveredNames = logs
      .filter((l) => l.ok && !l.skipped)
      .map((l) => l.channelName)
      .join(' / ');

    appendAuditLog(
      'INFO',
      'NOTIFIER_DISPATCHED',
      clientIp,
      `买家申报订单 ${updatedOrder.id} (¥${centsToYuan(updatedOrder.actualAmountCents)} · 口令 ${updatedOrder.remarkCode}) 已支付${deliveredNames ? `，已推送至 [${deliveredNames}]` : ''}`
    );
    savePersistedState();

    return res.json({
      code: 0,
      msg: deliveredNames
        ? `已通过 ${deliveredNames} 发送核销提醒，站长确认后本页自动跳转`
        : '已提交付款申报，等待站长确认核销',
      data: {
        orderId: updatedOrder.id,
        status: updatedOrder.status,
      },
    });
  });

  // =========================================================================
  // 3. Mobile Two-Step Signed Approval Confirmation Page Endpoints
  //    (Step 1: GET /api/v1/approve/inspect is pure read-only, safe against email/IM link scanners)
  //    (Step 2: POST /api/v1/approve/decide mutates order status on explicit button tap)
  // =========================================================================
  app.get('/api/v1/approve/inspect', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);
    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipApprovalRateLimitBuckets,
      clientIp,
      limitPerMinute: 30,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        code: 429,
        msg: `请求过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
      });
    }

    const orderId = String(req.query.orderId || '').trim();
    const token = String(req.query.token || '').trim();

    const order = serverOrders.find((o) => o.id === orderId);
    if (!order) {
      return res.status(404).json({ code: 404, msg: '未找到该收款订单' });
    }

    if (!isOrderApprovalTokenValid(token, order.approvalToken, nowMs)) {
      return res.status(403).json({
        code: 403,
        msg: '审批签名链接无效或已过期，请从最新通知卡片打开或登录后台处理',
      });
    }

    return res.json({
      code: 0,
      data: {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        productTitle: order.productTitle,
        channel: order.channel,
        channelName: CHANNEL_META[order.channel].name,
        nominalAmountYuan: centsToYuan(order.nominalAmountCents),
        actualAmountYuan: centsToYuan(order.actualAmountCents),
        remarkCode: order.remarkCode,
        payerNickName: order.payerNickName,
        payerEmail: order.payerEmail,
        payerMessage: order.payerMessage,
        status: order.status,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        rejectedAt: order.rejectedAt,
        settlementMethod: order.settlementMethod,
      },
    });
  });

  app.post('/api/v1/approve/decide', async (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);
    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipApprovalRateLimitBuckets,
      clientIp,
      limitPerMinute: 20,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        code: 429,
        msg: `操作过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
      });
    }

    const { orderId, token, decision, action } = req.body || {};
    const order = serverOrders.find((o) => o.id === String(orderId || '').trim());
    if (!order) {
      return res.status(404).json({ code: 404, msg: '未找到该收款订单' });
    }

    if (!isOrderApprovalTokenValid(String(token || '').trim(), order.approvalToken, nowMs)) {
      return res.status(403).json({ code: 403, msg: '审批签名校验未通过或已过期' });
    }

    const normalizedDecision = String(decision || action || '').trim().toUpperCase();
    if (normalizedDecision !== 'APPROVE' && normalizedDecision !== 'REJECT') {
      return res.status(400).json({ code: 400, msg: 'action/decision 参数必须为 approve 或 reject' });
    }

    if (order.status === 'PAID') {
      return res.json({
        code: 0,
        msg: '该订单此前已完成核销入账（幂等返回）',
        data: { orderId: order.id, status: order.status, paidAt: order.paidAt },
      });
    }

    if (normalizedDecision === 'APPROVE') {
      const settled = await settleAndApproveOrder({
        order,
        settlementMethod: 'APPROVAL_LINK',
        clientIp,
      });
      return res.json({
        code: 0,
        msg: `订单 ${settled.id} (¥${centsToYuan(settled.actualAmountCents)}) 已核销入账！`,
        data: {
          orderId: settled.id,
          status: settled.status,
          paidAt: settled.paidAt,
          webhookStatus: settled.webhookStatus,
          webhookLastResponse: settled.webhookLastResponse,
        },
      });
    }

    const rejectedOrder: DoloPayOrder = {
      ...order,
      status: 'REJECTED',
      rejectedAt: nowMs,
    };
    serverOrders = serverOrders.map((o) => (o.id === rejectedOrder.id ? rejectedOrder : o));
    appendAuditLog(
      'WARN',
      'ORDER_REJECTED',
      clientIp,
      `管理员通过审批页驳回了订单 ${rejectedOrder.id} (¥${centsToYuan(rejectedOrder.actualAmountCents)})`
    );
    savePersistedState();

    return res.json({
      code: 0,
      msg: `订单 ${rejectedOrder.id} 已驳回`,
      data: {
        orderId: rejectedOrder.id,
        status: rejectedOrder.status,
        rejectedAt: rejectedOrder.rejectedAt,
      },
    });
  });

  // =========================================================================
  // 4. Core REST v1 Merchant Order Creation API (External App Integration)
  // =========================================================================
  app.post('/api/v1/orders/create', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);
    const {
      appId,
      outTradeNo,
      channel,
      amount,
      productTitle,
      attach,
      notifyUrl,
      returnUrl,
      payerNickName,
      payerEmail,
      sign,
    } = req.body || {};

    const connectedApp =
      serverConnectedApps.find((a) => a.appId === appId && a.enabled) || serverConnectedApps[0];
    if (!connectedApp) {
      return res.status(401).json({ code: 401, msg: '无效或已禁用的 appId' });
    }

    if (notifyUrl && String(notifyUrl).trim()) {
      const check = validateSafeOutboundUrl(String(notifyUrl).trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `notifyUrl 安全校验未通过: ${check.error}` });
      }
    }

    let safeReturnUrl = connectedApp.returnUrl;
    if (returnUrl && String(returnUrl).trim()) {
      const check = validateSafeHttpUrl(String(returnUrl).trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `returnUrl 安全校验未通过: ${check.error}` });
      }
      safeReturnUrl = check.normalizedUrl;
    }

    const signParams: Record<string, string | number | undefined> = {
      appId: connectedApp.appId,
      outTradeNo: String(outTradeNo || ''),
      channel: String(channel || 'alipay'),
      amount: String(amount || ''),
      productTitle: String(productTitle || ''),
      attach: attach ? String(attach) : undefined,
      notifyUrl: notifyUrl ? String(notifyUrl) : undefined,
      returnUrl: returnUrl ? String(returnUrl) : undefined,
    };

    const { sign: expectedSign } = computeCanonicalOpenApiSign(
      signParams,
      connectedApp.appSecret,
      'HMAC-SHA256'
    );

    if (!sign || !constantTimeEqual(String(sign), expectedSign)) {
      appendAuditLog(
        'WARN',
        'SIGNATURE_REJECTED',
        clientIp,
        `外部应用 [${connectedApp.name}] 下单接口签名校验未通过`
      );
      return res.status(401).json({
        code: 401,
        errorCode: 'INVALID_OPENAPI_SIGNATURE',
        msg: 'OpenAPI HMAC-SHA256 签名校验未通过',
      });
    }

    const validChannels = getEnabledChannels();
    const targetChannel: PaymentChannel = validChannels.includes(channel) ? channel : 'alipay';
    const nominalCents = yuanToCents(amount);

    const alloc = allocatePayableAmount({
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      clientIp,
      existingOrders: serverOrders,
      maxPendingPerIp: serverSettings.maxPendingPerIp,
      enableCentFloat: Boolean(serverSettings.plugins.centFloat),
      floatStrategy: serverSettings.floatStrategy,
      maxFloatSteps: serverSettings.maxFloatSteps,
      nowMs,
    });

    if (!alloc.ok || !alloc.actualAmountCents) {
      return res.status(400).json({
        code: 400,
        errorCode: alloc.errorCode,
        msg: alloc.errorMessage,
      });
    }

    const orderId = `DP${nowMs.toString().slice(-8)}${crypto.randomInt(10, 99)}`;
    const remarkCode = generate6DigitRemarkCode(serverOrders, nowMs);
    const expiresAt = nowMs + serverSettings.orderTtlSeconds * 1000;
    const approvalToken = signOrderApprovalToken(
      orderId,
      nowMs,
      nowMs + 7 * 86400_000,
      approvalSecret
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: String(outTradeNo || `API_${orderId}`).trim().slice(0, 64),
      appId: connectedApp.appId,
      appName: connectedApp.name,
      protocol: connectedApp.protocol,
      attach: attach ? String(attach).slice(0, 200) : undefined,
      notifyUrl: notifyUrl ? String(notifyUrl).trim() : connectedApp.notifyUrl,
      returnUrl: safeReturnUrl,
      productTitle: String(productTitle || 'API 收款项目').trim().slice(0, 80),
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: String(payerNickName || '外部商户买家').trim().slice(0, 40),
      payerEmail: String(payerEmail || '').trim().slice(0, 80),
      payerMessage: attach ? `业务参数: ${String(attach).slice(0, 80)}` : '',
      clientIp,
      status: 'PENDING_PAYMENT',
      createdAt: nowMs,
      expiresAt,
      approvalToken,
      notificationLogs: [],
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    serverOrders = [newOrder, ...serverOrders];
    savePersistedState();

    const baseUrl = resolveTrustedPublicBaseUrl();
    return res.status(201).json({
      code: 0,
      msg: 'ok',
      data: {
        orderId: newOrder.id,
        outTradeNo: newOrder.outTradeNo,
        channel: newOrder.channel,
        nominalAmountYuan: centsToYuan(newOrder.nominalAmountCents),
        actualAmountYuan: centsToYuan(newOrder.actualAmountCents),
        remarkCode: newOrder.remarkCode,
        expiresAt: newOrder.expiresAt,
        cashierUrl: `${baseUrl}/?orderId=${encodeURIComponent(newOrder.id)}`,
      },
    });
  });

  // =========================================================================
  // 5. Optional Plugin Endpoints (EPay Compat & Android Listener Webhook)
  // =========================================================================
  app.all('/api/v1/epay/:action', (req, res) => {
    if (!serverSettings.plugins.epay) {
      return res.status(403).json({
        code: 403,
        msg: '易支付 (EPay) 兼容插件当前未启用，请在管理后台「扩展中心」开启后再调用',
      });
    }

    const nowMs = Date.now();
    const clientIp = extractClientIp(req);
    const params = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string>) };
    const { pid, type, out_trade_no, notify_url, return_url, name, money, param, sign } = params;

    const epayApp =
      serverConnectedApps.find((a) => a.appId === pid && a.enabled) ||
      serverConnectedApps.find((a) => a.protocol === 'EPAY_COMPAT' && a.enabled) ||
      serverConnectedApps[0];

    if (!epayApp) {
      return res.status(400).json({ code: -1, msg: '未找到匹配的易支付商户 PID' });
    }

    if (notify_url && String(notify_url).trim()) {
      const check = validateSafeOutboundUrl(String(notify_url).trim());
      if (!check.ok) {
        return res.status(400).json({ code: -1, msg: `notify_url 安全校验未通过: ${check.error}` });
      }
    }

    let safeReturnUrl = epayApp.returnUrl;
    if (return_url && String(return_url).trim()) {
      const check = validateSafeHttpUrl(String(return_url).trim());
      if (!check.ok) {
        return res.status(400).json({ code: -1, msg: `return_url 安全校验未通过: ${check.error}` });
      }
      safeReturnUrl = check.normalizedUrl;
    }

    const { sign: expectedSign } = computeCanonicalOpenApiSign(params, epayApp.appSecret, 'MD5');
    if (!sign || !constantTimeEqual(String(sign).toLowerCase(), expectedSign.toLowerCase())) {
      return res.status(401).json({ code: -1, msg: '易支付 MD5 签名校验失败' });
    }

    const channelMap: Record<string, PaymentChannel> = {
      alipay: 'alipay',
      wxpay: 'wechat',
      wechat: 'wechat',
      unionpay: 'unionpay',
    };
    const targetChannel = channelMap[type] || 'alipay';
    const nominalCents = yuanToCents(money);

    const alloc = allocatePayableAmount({
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      clientIp,
      existingOrders: serverOrders,
      maxPendingPerIp: serverSettings.maxPendingPerIp,
      enableCentFloat: Boolean(serverSettings.plugins.centFloat),
      floatStrategy: serverSettings.floatStrategy,
      maxFloatSteps: serverSettings.maxFloatSteps,
      nowMs,
    });

    if (!alloc.ok || !alloc.actualAmountCents) {
      return res.status(400).json({ code: -1, msg: alloc.errorMessage });
    }

    const orderId = `DP${nowMs.toString().slice(-8)}${crypto.randomInt(10, 99)}`;
    const remarkCode = generate6DigitRemarkCode(serverOrders, nowMs);
    const approvalToken = signOrderApprovalToken(
      orderId,
      nowMs,
      nowMs + 7 * 86400_000,
      approvalSecret
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: String(out_trade_no || `EPAY_${orderId}`).slice(0, 64),
      appId: epayApp.appId,
      appName: epayApp.name,
      protocol: 'EPAY_COMPAT',
      attach: param ? String(param) : undefined,
      notifyUrl: notify_url || epayApp.notifyUrl,
      returnUrl: safeReturnUrl,
      productTitle: String(name || '易支付订单').slice(0, 80),
      channel: targetChannel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: '易支付买家',
      payerEmail: '',
      payerMessage: '',
      clientIp,
      status: 'PENDING_PAYMENT',
      createdAt: nowMs,
      expiresAt: nowMs + serverSettings.orderTtlSeconds * 1000,
      approvalToken,
      notificationLogs: [],
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    serverOrders = [newOrder, ...serverOrders];
    savePersistedState();

    const baseUrl = resolveTrustedPublicBaseUrl();
    return res.json({
      code: 1,
      msg: 'success',
      trade_no: newOrder.id,
      payurl: `${baseUrl}/?orderId=${encodeURIComponent(newOrder.id)}`,
      money: centsToYuan(newOrder.actualAmountCents),
      remark_code: newOrder.remarkCode,
    });
  });

  app.post('/api/v1/webhook/notify', async (req, res) => {
    if (!serverSettings.plugins.androidListener) {
      return res.status(403).json({
        code: 403,
        msg: '安卓通知栏监听插件当前未启用，请在管理后台「扩展中心」开启后再上报',
      });
    }

    const nowMs = Date.now();
    const clientIp = extractClientIp(req);
    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipWebhookRateLimitBuckets,
      clientIp,
      limitPerMinute: 60,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({ code: 429, msg: 'Webhook frequency limit exceeded' });
    }

    const { channel, amountYuan, timestamp, deviceTxId, deviceName, sign } = req.body || {};
    const result = processWebhookNotification({
      payload: {
        channel: channel as PaymentChannel,
        amountYuan: String(amountYuan || ''),
        timestamp: Number(timestamp),
        deviceTxId: String(deviceTxId || ''),
        deviceName: deviceName ? String(deviceName) : clientIp,
        sign: String(sign || ''),
      },
      orders: serverOrders,
      androidWebhookSecret: serverSettings.androidWebhookSecret,
      webhookReplayWindowSeconds: serverSettings.webhookReplayWindowSeconds,
      nowMs,
    });

    securityAuditLogs = [result.auditEvent, ...securityAuditLogs].slice(0, 100);

    if (!result.ok || !result.matchedOrder) {
      savePersistedState();
      const status =
        result.errorCode === 'INVALID_SIGNATURE' || result.errorCode === 'TIMESTAMP_EXPIRED'
          ? 401
          : 200;
      return res.status(status).json({
        code: status === 200 ? 0 : 401,
        errorCode: result.errorCode,
        msg: result.message,
      });
    }

    serverOrders = result.updatedOrders;
    const settled = await settleAndApproveOrder({
      order: result.matchedOrder,
      settlementMethod: 'ANDROID_WEBHOOK',
      clientIp,
    });

    return res.json({
      code: 0,
      msg: result.message,
      data: {
        orderId: settled.id,
        status: settled.status,
        webhookStatus: settled.webhookStatus,
      },
    });
  });

  // =========================================================================
  // 6. Admin Authentication & Bootstrap APIs
  // =========================================================================
  app.get(['/api/v1/admin/auth-status', '/api/v1/admin/auth/status'], (req, res) => {
    const token = extractAdminToken(req);
    const hasEnvPwd = Boolean(process.env.DOLOPAY_ADMIN_PASSWORD?.trim());
    const mode = hasEnvPwd
      ? 'ENV_PASSWORD'
      : adminPasswordHash
      ? 'CLAIMED_HASH'
      : 'NEEDS_BOOTSTRAP';
    const authenticated =
      Boolean(adminPasswordHash) &&
      verifyAdminSessionToken(token, 'dolopay_admin', sessionSecret, Date.now());
    if (authenticated) {
      recordTrustedAdminOriginFromRequest(req);
    }
    res.json({
      code: 0,
      data: {
        mode,
        initialized: Boolean(adminPasswordHash),
        authenticated,
      },
    });
  });

  app.post(['/api/v1/admin/bootstrap', '/api/v1/admin/auth/bootstrap'], (req, res) => {
    const clientIp = extractClientIp(req);
    if (adminPasswordHash) {
      return res.status(400).json({
        code: 400,
        msg: '管理员密码已初始化，请直接登录',
      });
    }
    const password = String(req.body?.password || '').trim();
    if (password.length < 6) {
      return res.status(400).json({
        code: 400,
        msg: '请设置至少 6 位的管理后台密码',
      });
    }
    adminPasswordHash = hashAdminPassword(password);
    recordTrustedAdminOriginFromRequest(req);
    appendAuditLog('INFO', 'ADMIN_BOOTSTRAPPED', clientIp, '完成首次管理后台密码初始化');
    savePersistedState();

    const nowMs = Date.now();
    const token = signAdminSessionToken('dolopay_admin', nowMs, nowMs + 12 * 3600_000, sessionSecret);
    return res.json({
      code: 0,
      msg: '管理员密码设置成功',
      data: { token, expiresAt: nowMs + 12 * 3600_000 },
    });
  });

  app.post(['/api/v1/admin/login', '/api/v1/admin/auth/login'], (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractClientIp(req);

    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipLoginRateLimitBuckets,
      clientIp,
      limitPerMinute: 10,
      nowMs,
    });
    if (!rateCheck.allowed) {
      return res.status(429).json({
        code: 429,
        msg: `登录尝试过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后再试`,
      });
    }

    if (!adminPasswordHash) {
      return res.status(400).json({
        code: 400,
        errorCode: 'ADMIN_NOT_INITIALIZED',
        msg: '请先设置初始管理员密码',
      });
    }

    const password = String(req.body?.password || '');
    if (!verifyAdminPasswordHash(password, adminPasswordHash)) {
      appendAuditLog('WARN', 'ADMIN_LOGIN_FAILED', clientIp, '管理后台登录密码验证失败');
      savePersistedState();
      return res.status(401).json({
        code: 401,
        msg: '管理员密码不正确',
      });
    }

    recordTrustedAdminOriginFromRequest(req);
    const token = signAdminSessionToken('dolopay_admin', nowMs, nowMs + 12 * 3600_000, sessionSecret);
    appendAuditLog('INFO', 'ADMIN_LOGIN_SUCCESS', clientIp, '管理员登录后台成功');
    savePersistedState();

    return res.json({
      code: 0,
      msg: '登录成功',
      data: { token, expiresAt: nowMs + 12 * 3600_000 },
    });
  });

  // =========================================================================
  // 7. Protected Admin Management APIs (State, Orders, QR Upload, Notifiers, Plugins)
  // =========================================================================
  app.get('/api/v1/admin/state', requireAdminAuth, (_req, res) => {
    const nowMs = Date.now();
    const { updatedOrders } = sweepExpiredOrders(serverOrders, nowMs);
    serverOrders = updatedOrders;

    const resolvedPlugins = resolvePluginStates(
      serverSettings.plugins,
      process.env.DOLOPAY_ENABLED_PLUGINS,
      process.env.DOLOPAY_DISABLED_PLUGINS
    );
    serverSettings.plugins = resolvedPlugins.states;

    const baseUrl = resolveTrustedPublicBaseUrl();

    res.json({
      code: 0,
      data: {
        settings: serverSettings,
        detectedBaseUrl: baseUrl,
        pluginRegistry: OPTIONAL_PLUGIN_REGISTRY,
        lockedDisabledPlugins: resolvedPlugins.lockedDisabled,
        qrSlots: buildQrSlotsStatusForClient(),
        connectedApps: serverConnectedApps,
        orders: serverOrders.map((o) => ({
          ...o,
          approvalUrl: buildOrderApprovalUrl(baseUrl, o),
        })),
        metrics: calculateDashboardMetrics(serverOrders, nowMs),
        securityAuditLogs: securityAuditLogs.slice(0, 40),
      },
    });
  });

  // Admin Manual Approve Order
  app.post('/api/v1/admin/orders/:id/approve', requireAdminAuth, async (req, res) => {
    const clientIp = extractClientIp(req);
    const target = serverOrders.find((o) => o.id === req.params.id);
    if (!target) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    const settled = await settleAndApproveOrder({
      order: target,
      settlementMethod: 'MANUAL_ADMIN',
      clientIp,
    });
    return res.json({
      code: 0,
      msg: `订单 ${settled.id} 已确认核销入账`,
      data: settled,
    });
  });

  // Admin Manual Reject Order
  app.post('/api/v1/admin/orders/:id/reject', requireAdminAuth, (req, res) => {
    const clientIp = extractClientIp(req);
    const target = serverOrders.find((o) => o.id === req.params.id);
    if (!target) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    const rejected: DoloPayOrder = {
      ...target,
      status: 'REJECTED',
      rejectedAt: Date.now(),
    };
    serverOrders = serverOrders.map((o) => (o.id === rejected.id ? rejected : o));
    appendAuditLog(
      'WARN',
      'ORDER_REJECTED',
      clientIp,
      `管理员在后台驳回了订单 ${rejected.id} (¥${centsToYuan(rejected.actualAmountCents)})`
    );
    savePersistedState();
    return res.json({
      code: 0,
      msg: `订单 ${rejected.id} 已驳回`,
      data: rejected,
    });
  });

  // Admin Retry Downstream Webhook
  app.post('/api/v1/admin/orders/:id/retry-webhook', requireAdminAuth, async (req, res) => {
    const target = serverOrders.find((o) => o.id === req.params.id);
    if (!target) {
      return res.status(404).json({ code: 404, msg: '订单不存在' });
    }
    const connectedApp = serverConnectedApps.find((a) => a.appId === target.appId);
    const result = await dispatchMerchantWebhook({
      order: target,
      connectedApp,
      fallbackSecretKey: connectedApp?.appSecret || sessionSecret,
      nowMs: Date.now(),
    });
    const updated: DoloPayOrder = {
      ...target,
      webhookStatus: result.status,
      webhookAttempts: (target.webhookAttempts || 0) + 1,
      webhookLastResponse: result.responseText,
    };
    serverOrders = serverOrders.map((o) => (o.id === updated.id ? updated : o));
    savePersistedState();
    return res.json({
      code: 0,
      msg: `回调重发完成: ${result.responseText}`,
      data: updated,
    });
  });

  // Clear Demo Orders (One-click cleanup for production deployment)
  const handleClearDemoOrders = (_req: Request, res: Response) => {
    const before = serverOrders.length;
    serverOrders = serverOrders.filter((o) => !o.isDemo);
    savePersistedState();
    return res.json({
      code: 0,
      msg: `已清理 ${before - serverOrders.length} 笔演示订单`,
    });
  };
  app.post('/api/v1/admin/orders/clear-demo', requireAdminAuth, handleClearDemoOrders);
  app.delete('/api/v1/admin/orders/demo', requireAdminAuth, handleClearDemoOrders);

  // Upload Personal QR Code Original Image
  app.post('/api/v1/admin/qrcodes/:channel/upload', requireAdminAuth, (req, res) => {
    const channel = req.params.channel as PaymentChannel;
    if (!['alipay', 'wechat', 'unionpay'].includes(channel)) {
      return res.status(400).json({ code: 400, msg: '无效的收款渠道' });
    }

    const { dataUrl } = req.body || {};
    const parsed = parseAndValidateQrImageDataUrl(String(dataUrl || ''));
    if (!parsed.ok) {
      return res.status(400).json({ code: 400, msg: parsed.error });
    }

    ensureDirectories();
    for (const oldExt of ['png', 'jpg', 'jpeg', 'webp']) {
      const oldPath = resolveConfinedPath(UPLOADED_QR_DIR, `${channel}.${oldExt}`);
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // ignore
        }
      }
    }

    const fileName = `${channel}.${parsed.ext}`;
    const targetPath = resolveConfinedPath(UPLOADED_QR_DIR, fileName);
    if (!targetPath) {
      return res.status(400).json({ code: 400, msg: '文件路径安全校验未通过' });
    }

    fs.writeFileSync(targetPath, parsed.buffer);
    serverQrSlots[channel] = {
      ...serverQrSlots[channel],
      enabled: true,
      uploadedFileName: fileName,
      updatedAt: Date.now(),
    };
    savePersistedState();

    return res.json({
      code: 0,
      msg: `${CHANNEL_META[channel].shortName}个人收款码原图已上传保存`,
      data: buildQrSlotsStatusForClient()[channel],
    });
  });

  // Remove Uploaded QR Image (reverts to public/qrcodes/ static drop-in if present)
  app.delete('/api/v1/admin/qrcodes/:channel/image', requireAdminAuth, (req, res) => {
    const channel = req.params.channel as PaymentChannel;
    if (!['alipay', 'wechat', 'unionpay'].includes(channel)) {
      return res.status(400).json({ code: 400, msg: '无效的收款渠道' });
    }
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const filePath = resolveConfinedPath(UPLOADED_QR_DIR, `${channel}.${ext}`);
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }
    serverQrSlots[channel] = {
      ...serverQrSlots[channel],
      uploadedFileName: undefined,
      updatedAt: Date.now(),
    };
    savePersistedState();

    return res.json({
      code: 0,
      msg: `已清除后台上传的 ${CHANNEL_META[channel].shortName} 收款码（若 public/qrcodes/ 下有静态图将自动使用）`,
      data: buildQrSlotsStatusForClient()[channel],
    });
  });

  // Update QR Slot Metadata (accountMask, paymentTip, enabled)
  const handleUpdateQrSlotMeta = (req: Request, res: Response) => {
    const channel = req.params.channel as PaymentChannel;
    if (!['alipay', 'wechat', 'unionpay'].includes(channel)) {
      return res.status(400).json({ code: 400, msg: '无效的收款渠道' });
    }
    const { enabled, displayName, accountMask, paymentTip } = req.body || {};
    const current = serverQrSlots[channel];
    serverQrSlots[channel] = {
      ...current,
      enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
      displayName:
        displayName !== undefined ? String(displayName).trim().slice(0, 40) : current.displayName,
      accountMask:
        accountMask !== undefined ? String(accountMask).trim().slice(0, 60) : current.accountMask,
      paymentTip:
        paymentTip !== undefined ? String(paymentTip).trim().slice(0, 100) : current.paymentTip,
      updatedAt: Date.now(),
    };
    savePersistedState();

    return res.json({
      code: 0,
      msg: `${CHANNEL_META[channel].shortName}收款设置已更新`,
      data: buildQrSlotsStatusForClient()[channel],
    });
  };
  app.put('/api/v1/admin/qrcodes/:channel', requireAdminAuth, handleUpdateQrSlotMeta);
  app.patch('/api/v1/admin/qrcodes/:channel', requireAdminAuth, handleUpdateQrSlotMeta);

  // Update Gateway Settings (Email / Feishu / DingTalk / Plugins / Base Config)
  app.put('/api/v1/admin/settings', requireAdminAuth, (req, res) => {
    const body = (req.body || {}) as Partial<GatewaySettings>;

    let validatedPublicBaseUrl = serverSettings.publicBaseUrl;
    if (body.publicBaseUrl !== undefined) {
      const rawBase = String(body.publicBaseUrl).trim().replace(/\/+$/, '');
      if (rawBase === '') {
        validatedPublicBaseUrl = '';
      } else {
        const check = validateSafeHttpUrl(rawBase);
        if (!check.ok) {
          return res.status(400).json({
            code: 400,
            msg: `PUBLIC_BASE_URL 格式无效: ${check.error}`,
          });
        }
        validatedPublicBaseUrl = check.origin;
      }
    }

    // Validate webhook URLs if provided
    if (body.feishu?.webhookUrl?.trim()) {
      const check = validateSafeOutboundUrl(body.feishu.webhookUrl.trim(), [
        'open.feishu.cn',
        'open.larksuite.com',
      ]);
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `飞书 Webhook 校验失败: ${check.error}` });
      }
    }
    if (body.dingtalk?.webhookUrl?.trim()) {
      const check = validateSafeOutboundUrl(body.dingtalk.webhookUrl.trim(), ['oapi.dingtalk.com']);
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `钉钉 Webhook 校验失败: ${check.error}` });
      }
    }
    if (body.bark?.pushUrl?.trim()) {
      const check = validateSafeOutboundUrl(body.bark.pushUrl.trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `Bark 推送地址校验失败: ${check.error}` });
      }
    }

    const nextPlugins: PluginStates = {
      ...serverSettings.plugins,
      ...(body.plugins || {}),
    };
    const resolvedPlugins = resolvePluginStates(
      nextPlugins,
      process.env.DOLOPAY_ENABLED_PLUGINS,
      process.env.DOLOPAY_DISABLED_PLUGINS
    );

    const allowedStrategies: FloatStrategy[] = [
      'EXACT_THEN_INCREMENT',
      'ALWAYS_INCREMENT',
      'EXACT_THEN_DECREMENT',
    ];

    serverSettings = {
      ...serverSettings,
      siteTitle:
        body.siteTitle !== undefined
          ? String(body.siteTitle).trim().slice(0, 50) || 'DoloPay 个人收银台'
          : serverSettings.siteTitle,
      publicBaseUrl: validatedPublicBaseUrl,
      orderTtlSeconds: Math.min(
        3600,
        Math.max(120, Number(body.orderTtlSeconds) || serverSettings.orderTtlSeconds)
      ),
      maxPendingPerIp: Math.min(
        20,
        Math.max(1, Number(body.maxPendingPerIp) || serverSettings.maxPendingPerIp)
      ),
      rateLimitPerMinute: Math.min(
        120,
        Math.max(5, Number(body.rateLimitPerMinute) || serverSettings.rateLimitPerMinute)
      ),
      floatStrategy:
        body.floatStrategy && allowedStrategies.includes(body.floatStrategy)
          ? body.floatStrategy
          : serverSettings.floatStrategy,
      maxFloatSteps: Math.min(
        50,
        Math.max(1, Number(body.maxFloatSteps) || serverSettings.maxFloatSteps)
      ),
      email: body.email ? { ...serverSettings.email, ...body.email } : serverSettings.email,
      feishu: body.feishu ? { ...serverSettings.feishu, ...body.feishu } : serverSettings.feishu,
      dingtalk: body.dingtalk
        ? { ...serverSettings.dingtalk, ...body.dingtalk }
        : serverSettings.dingtalk,
      bark: body.bark ? { ...serverSettings.bark, ...body.bark } : serverSettings.bark,
      telegram: body.telegram
        ? { ...serverSettings.telegram, ...body.telegram }
        : serverSettings.telegram,
      androidWebhookSecret:
        body.androidWebhookSecret !== undefined
          ? String(body.androidWebhookSecret).trim()
          : serverSettings.androidWebhookSecret,
      webhookReplayWindowSeconds: Math.min(
        900,
        Math.max(30, Number(body.webhookReplayWindowSeconds) || serverSettings.webhookReplayWindowSeconds)
      ),
      plugins: resolvedPlugins.states,
    };

    savePersistedState();
    return res.json({
      code: 0,
      msg: '审批通道与网关设置已保存生效',
      data: serverSettings,
    });
  });

  // Test Single Notification Channel (Email / Feishu / DingTalk / Bark / Telegram)
  app.post(
    ['/api/v1/admin/notifications/test', '/api/v1/admin/notifiers/test'],
    requireAdminAuth,
    async (req, res) => {
      const channelId = String(req.body?.channel || 'email') as ApprovalNotifierId;
      const baseUrl = resolveTrustedPublicBaseUrl();
      const previewOrder = serverOrders[0];
      const approvalUrl = previewOrder
        ? buildOrderApprovalUrl(baseUrl, previewOrder)
        : `${baseUrl}/approve`;

      const result = await sendSingleTestNotification(channelId, serverSettings, approvalUrl);
      return res.status(result.ok ? 200 : 400).json({
        code: result.ok ? 0 : 400,
        msg: result.message,
      });
    }
  );

  // Connected Apps Management (Core REST + Optional EPay/Stripe)
  app.post('/api/v1/admin/apps', requireAdminAuth, (req, res) => {
    const { name, protocol, notifyUrl, returnUrl } = req.body || {};
    if (notifyUrl && String(notifyUrl).trim()) {
      const check = validateSafeOutboundUrl(String(notifyUrl).trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `回调 URL 校验未通过: ${check.error}` });
      }
    }
    let safeReturnUrl = '';
    if (returnUrl && String(returnUrl).trim()) {
      const check = validateSafeHttpUrl(String(returnUrl).trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `跳转 returnUrl 校验未通过: ${check.error}` });
      }
      safeReturnUrl = check.normalizedUrl;
    }

    const allowedProtocols: IntegrationProtocol[] = [
      'DOLOPAY_REST_V1',
      'EPAY_COMPAT',
      'STRIPE_WEBHOOK',
    ];
    const targetProto: IntegrationProtocol = allowedProtocols.includes(protocol)
      ? protocol
      : 'DOLOPAY_REST_V1';

    const newApp: ConnectedApp = {
      id: `app_${Date.now()}`,
      name: String(name || '外部接入站点').trim().slice(0, 40),
      appId:
        targetProto === 'EPAY_COMPAT'
          ? String(crypto.randomInt(10000, 99999))
          : `dp_${crypto.randomBytes(4).toString('hex')}`,
      appSecret: generateSecureSecret('sec', 16),
      protocol: targetProto,
      notifyUrl: String(notifyUrl || '').trim(),
      returnUrl: safeReturnUrl,
      enabled: true,
      totalOrders: 0,
      totalPaidCents: 0,
      createdAt: Date.now(),
    };
    serverConnectedApps = [...serverConnectedApps, newApp];
    savePersistedState();
    return res.status(201).json({ code: 0, msg: '接入应用已创建', data: newApp });
  });

  app.patch('/api/v1/admin/apps/:id', requireAdminAuth, (req, res) => {
    const { name, notifyUrl, returnUrl, enabled } = req.body || {};
    if (notifyUrl && String(notifyUrl).trim()) {
      const check = validateSafeOutboundUrl(String(notifyUrl).trim());
      if (!check.ok) {
        return res.status(400).json({ code: 400, msg: `回调 URL 校验未通过: ${check.error}` });
      }
    }
    let validatedReturnUrl: string | undefined;
    if (returnUrl !== undefined) {
      const rawReturn = String(returnUrl).trim();
      if (rawReturn === '') {
        validatedReturnUrl = '';
      } else {
        const check = validateSafeHttpUrl(rawReturn);
        if (!check.ok) {
          return res.status(400).json({ code: 400, msg: `跳转 returnUrl 校验未通过: ${check.error}` });
        }
        validatedReturnUrl = check.normalizedUrl;
      }
    }

    let found = false;
    serverConnectedApps = serverConnectedApps.map((a) => {
      if (a.id !== req.params.id) return a;
      found = true;
      return {
        ...a,
        name: name !== undefined ? String(name).trim().slice(0, 40) : a.name,
        notifyUrl: notifyUrl !== undefined ? String(notifyUrl).trim() : a.notifyUrl,
        returnUrl: validatedReturnUrl !== undefined ? validatedReturnUrl : a.returnUrl,
        enabled: typeof enabled === 'boolean' ? enabled : a.enabled,
      };
    });
    if (!found) return res.status(404).json({ code: 404, msg: '应用不存在' });
    savePersistedState();
    return res.json({ code: 0, msg: '应用回调配置已更新' });
  });

  app.post('/api/v1/admin/apps/:id/rotate-secret', requireAdminAuth, (req, res) => {
    let newSecret = '';
    serverConnectedApps = serverConnectedApps.map((a) => {
      if (a.id !== req.params.id) return a;
      newSecret = generateSecureSecret('sec', 16);
      return { ...a, appSecret: newSecret };
    });
    if (!newSecret) return res.status(404).json({ code: 404, msg: '应用不存在' });
    savePersistedState();
    return res.json({ code: 0, msg: '应用签名密钥已重置', data: { appSecret: newSecret } });
  });

  // =========================================================================
  // 8. Vite Dev Middleware / Production Static Assets
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DoloPay] Personal QR Gateway listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

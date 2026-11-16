import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  yuanToCents,
  centsToYuan,
  constantTimeEqual,
  allocatePayableAmount,
  matchQrCodeFromPool,
  computeCanonicalOpenApiSign,
  signAdminSessionToken,
  verifyAdminSessionToken,
  checkSlidingWindowRateLimit,
  processWebhookNotification,
  buildMerchantWebhookEnvelope,
  sweepExpiredOrders,
  type ConnectedApp,
  type NotificationChannelConfig,
  type PaymentChannel,
  type QrCodeItem,
  type SecurityAuditEvent,
  type DoloPayOrder,
  type SystemRiskConfig,
} from './src/core/dolopayEngine';
import {
  INITIAL_RISK_CONFIG,
  createInitialConnectedApps,
  createInitialNotificationChannels,
  createInitialOrders,
  createInitialQrPool,
  createInitialSecurityAuditLogs,
} from './src/core/seedData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PersistedGatewaySnapshot {
  version: number;
  updatedAt: number;
  riskConfig: SystemRiskConfig;
  connectedApps: ConnectedApp[];
  notificationChannels: NotificationChannelConfig[];
  qrPool: QrCodeItem[];
  orders: DoloPayOrder[];
  securityAuditLogs: SecurityAuditEvent[];
}

const DATA_DIR = path.join(__dirname, '.data');
const STORE_FILE = path.join(DATA_DIR, 'dolopay-store.json');

const serverNow = Date.now();
let serverRiskConfig: SystemRiskConfig = {
  ...INITIAL_RISK_CONFIG,
  adminPassword: process.env.DOLOPAY_ADMIN_PASSWORD || INITIAL_RISK_CONFIG.adminPassword,
};
let serverConnectedApps: ConnectedApp[] = createInitialConnectedApps(serverNow);
let serverNotificationChannels: NotificationChannelConfig[] = createInitialNotificationChannels();
let serverQrPool: QrCodeItem[] = createInitialQrPool(serverNow);
let serverOrders: DoloPayOrder[] = createInitialOrders(serverNow);
let serverAuditLogs: SecurityAuditEvent[] = createInitialSecurityAuditLogs(serverNow);

const ipRateLimitBuckets = new Map<string, number[]>();

function loadPersistedState(): void {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      persistGatewayStateAtomically();
      return;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedGatewaySnapshot>;
    if (parsed && parsed.version === 1) {
      if (parsed.riskConfig) {
        serverRiskConfig = {
          ...INITIAL_RISK_CONFIG,
          ...parsed.riskConfig,
          adminPassword:
            process.env.DOLOPAY_ADMIN_PASSWORD ||
            parsed.riskConfig.adminPassword ||
            INITIAL_RISK_CONFIG.adminPassword,
        };
      }
      if (Array.isArray(parsed.connectedApps)) serverConnectedApps = parsed.connectedApps;
      if (Array.isArray(parsed.notificationChannels)) {
        serverNotificationChannels = parsed.notificationChannels;
      }
      if (Array.isArray(parsed.qrPool)) serverQrPool = parsed.qrPool;
      if (Array.isArray(parsed.orders)) serverOrders = parsed.orders;
      if (Array.isArray(parsed.securityAuditLogs)) {
        serverAuditLogs = parsed.securityAuditLogs;
      }
    }
  } catch (err) {
    console.warn('[DoloPay Store] Failed to load persisted snapshot, using seed state:', err);
  }
}

function persistGatewayStateAtomically(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const snapshot: PersistedGatewaySnapshot = {
      version: 1,
      updatedAt: Date.now(),
      riskConfig: serverRiskConfig,
      connectedApps: serverConnectedApps,
      notificationChannels: serverNotificationChannels,
      qrPool: serverQrPool,
      orders: serverOrders,
      securityAuditLogs: serverAuditLogs.slice(0, 100),
    };
    const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch (err) {
    console.warn('[DoloPay Store] Atomic persistence warning:', err);
  }
}

function appendAuditLog(event: SecurityAuditEvent): void {
  serverAuditLogs = [event, ...serverAuditLogs].slice(0, 100);
}

function extractRealClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

async function startServer() {
  loadPersistedState();

  // Periodic TTL lock expiration daemon (every 5s)
  setInterval(() => {
    const now = Date.now();
    const { updatedOrders, expiredOrderIds } = sweepExpiredOrders(serverOrders, now);
    if (expiredOrderIds.length > 0) {
      serverOrders = updatedOrders;
      persistGatewayStateAtomically();
    }
  }, 5000);

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // 1. Open Gateway Health & Security Capabilities Endpoint
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      code: 0,
      service: 'DoloPay-Personal-QR-Gateway',
      version: '2.5.0-sec',
      protocols: ['DOLOPAY_REST_V1', 'EPAY_COMPAT', 'STRIPE_WEBHOOK'],
      cryptoSuites: ['HMAC-SHA256 (RFC 2104)', 'MD5 (RFC 1321 EPay-Compat)', 'Constant-Time Equal'],
      securityPosture: {
        replayWindowSeconds: serverRiskConfig.webhookReplayWindowSeconds,
        rateLimitPerMinute: serverRiskConfig.rateLimitPerMinute,
        requireAdminAuth: serverRiskConfig.requireAdminAuth,
        atomicDiskPersistence: fs.existsSync(STORE_FILE),
      },
      channels: ['alipay', 'wechat', 'unionpay'],
      timestamp: Date.now(),
    });
  });

  // 2. Admin Session Authentication (POST /api/v1/admin/login)
  app.post('/api/v1/admin/login', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractRealClientIp(req);
    const { password = '' } = req.body || {};

    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipRateLimitBuckets,
      clientIp: `login_${clientIp}`,
      limitPerMinute: 10,
      nowMs,
    });

    if (!rateCheck.allowed) {
      appendAuditLog({
        id: `sec_${nowMs}_rl`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'IP_RATE_LIMITED',
        clientIp,
        summary: `管理员登录接口触发防爆破限流 (${clientIp})，请 ${rateCheck.retryAfterSeconds}s 后重试`,
      });
      persistGatewayStateAtomically();
      res.status(429).json({
        code: 4029,
        msg: `登录尝试过于频繁，请 ${rateCheck.retryAfterSeconds} 秒后重试`,
      });
      return;
    }

    const expectedPassword =
      process.env.DOLOPAY_ADMIN_PASSWORD || serverRiskConfig.adminPassword || 'DoloPay@2026';

    if (!constantTimeEqual(String(password), expectedPassword)) {
      appendAuditLog({
        id: `sec_${nowMs}_fail`,
        timestamp: nowMs,
        level: 'WARN',
        eventType: 'ADMIN_LOGIN_FAILED',
        clientIp,
        summary: `管理后台口令验证失败 (来源 IP: ${clientIp})`,
      });
      persistGatewayStateAtomically();
      res.status(401).json({
        code: 4001,
        msg: '管理员访问口令不正确（常量时间比对已拒绝）',
      });
      return;
    }

    const expiresAtMs = nowMs + 12 * 3600_000;
    const token = signAdminSessionToken(
      serverRiskConfig.adminEmail,
      nowMs,
      expiresAtMs,
      serverRiskConfig.webhookSecretKey
    );

    appendAuditLog({
      id: `sec_${nowMs}_ok`,
      timestamp: nowMs,
      level: 'INFO',
      eventType: 'ADMIN_LOGIN_SUCCESS',
      clientIp,
      summary: `管理员认证成功，已签发 HMAC-SHA256 会话 Token (有效期 12h)`,
    });
    persistGatewayStateAtomically();

    res.json({
      code: 0,
      msg: '管理员认证通过',
      data: {
        token,
        adminEmail: serverRiskConfig.adminEmail,
        issuedAt: nowMs,
        expiresAt: expiresAtMs,
      },
    });
  });

  // 3. Universal Open API: Create Order (POST /api/v1/orders/create)
  app.post('/api/v1/orders/create', (req, res) => {
    const nowMs = Date.now();
    const realClientIp = extractRealClientIp(req);

    // Per-IP Sliding Window Rate Limiting
    const rateCheck = checkSlidingWindowRateLimit({
      bucketMap: ipRateLimitBuckets,
      clientIp: realClientIp,
      limitPerMinute: serverRiskConfig.rateLimitPerMinute || 30,
      nowMs,
    });

    if (!rateCheck.allowed) {
      appendAuditLog({
        id: `sec_${nowMs}_apirl`,
        timestamp: nowMs,
        level: 'WARN',
        eventType: 'IP_RATE_LIMITED',
        clientIp: realClientIp,
        summary: `下单接口触发滑动窗口限流：单 IP (${realClientIp}) 超过 ${serverRiskConfig.rateLimitPerMinute} 次/分钟上限`,
      });
      persistGatewayStateAtomically();
      res.status(429).json({
        code: 4029,
        errorCode: 'API_RATE_LIMITED',
        msg: `请求频率超限 (${serverRiskConfig.rateLimitPerMinute} 次/分钟)，请 ${rateCheck.retryAfterSeconds} 秒后重试`,
      });
      return;
    }

    const {
      appId = 'app_indiecloud_prod',
      outTradeNo = `EXT_${nowMs}`,
      channel = 'alipay',
      amount = '10.00',
      productTitle = '外部系统接入收款单',
      attach = '',
      notifyUrl = '',
      returnUrl = '',
      payerEmail = 'api-buyer@example.com',
      payerNickName = 'API 接入买家',
      sign,
      skipSignVerify = false,
    } = req.body || {};

    const connectedApp =
      serverConnectedApps.find((a) => a.appId === appId) || serverConnectedApps[0];

    const signMode = connectedApp.protocol === 'EPAY_COMPAT' ? 'MD5' : 'HMAC-SHA256';
    const signParams = {
      appId,
      outTradeNo,
      channel,
      amount: String(amount),
      productTitle,
      attach,
      notifyUrl: notifyUrl || connectedApp.notifyUrl,
    };

    const { canonicalString, sign: expectedSign } = computeCanonicalOpenApiSign(
      signParams,
      connectedApp.appSecret,
      signMode
    );

    const adminTokenHeader = req.headers['x-dolopay-admin-token'] as string | undefined;
    const isCallerAdmin = verifyAdminSessionToken(
      adminTokenHeader,
      serverRiskConfig.adminEmail,
      serverRiskConfig.webhookSecretKey,
      nowMs
    );

    if (!sign || !constantTimeEqual(String(sign), expectedSign)) {
      appendAuditLog({
        id: `sec_${nowMs}_apisig`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'SIGNATURE_REJECTED',
        clientIp: realClientIp,
        summary: `Open API 下单签名校验失败或缺失签名 (应用 ${connectedApp.appId} · 算法 ${signMode})`,
      });
      persistGatewayStateAtomically();
      res.status(401).json({
        code: 4001,
        msg: `Open API ${signMode} 签名校验未通过 (INVALID_SIGNATURE)`,
      });
      return;
    }

    const nominalCents = yuanToCents(String(amount));
    const validChannel: PaymentChannel =
      channel === 'wechat' || channel === 'unionpay' ? channel : 'alipay';

    const alloc = allocatePayableAmount({
      channel: validChannel,
      nominalAmountCents: nominalCents,
      clientIp: realClientIp,
      existingOrders: serverOrders,
      riskConfig: serverRiskConfig,
      nowMs,
    });

    if (!alloc.ok || alloc.actualAmountCents === undefined) {
      if (alloc.errorCode === 'IP_RATE_LIMITED') {
        appendAuditLog({
          id: `sec_${nowMs}_iplock`,
          timestamp: nowMs,
          level: 'WARN',
          eventType: 'IP_RATE_LIMITED',
          clientIp: realClientIp,
          summary: alloc.errorMessage || '单 IP 待付金额锁达到上限',
        });
        persistGatewayStateAtomically();
      }
      res.status(429).json({
        code: 4029,
        errorCode: alloc.errorCode,
        msg: alloc.errorMessage,
      });
      return;
    }

    const { qrItem, matchType } = matchQrCodeFromPool(
      serverQrPool,
      validChannel,
      alloc.actualAmountCents
    );

    const seq = String(serverOrders.length + 101).padStart(3, '0');
    const orderId = `DP20261115${seq}`;
    const remarkCode = String(Math.floor(100000 + Math.random() * 900000));
    const approvalToken = signAdminSessionToken(
      orderId,
      nowMs,
      nowMs + 86400_000,
      serverRiskConfig.webhookSecretKey
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: String(outTradeNo),
      appId: connectedApp.appId,
      appName: connectedApp.name,
      protocol: connectedApp.protocol,
      attach: String(attach),
      notifyUrl: String(notifyUrl || connectedApp.notifyUrl),
      returnUrl: String(returnUrl || connectedApp.returnUrl),
      productTitle: String(productTitle),
      channel: validChannel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: String(payerNickName),
      payerEmail: String(payerEmail),
      payerMessage: attach ? `透传参数: ${attach}` : 'Open API 创建订单',
      clientIp: realClientIp,
      status: 'PENDING_PAYMENT',
      qrCodeId: qrItem?.id || 'qr_default',
      qrMatchType: matchType,
      qrPayloadUrl: qrItem?.qrPayloadUrl || 'https://qr.alipay.com/fkxdefault',
      createdAt: nowMs,
      expiresAt: nowMs + serverRiskConfig.orderTtlSeconds * 1000,
      approvalToken,
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    serverOrders = [newOrder, ...serverOrders];
    persistGatewayStateAtomically();

    // 严禁向普通外部客户端返回已签名的 PAID 回调报文 (webhookPreviewOnPaid)，仅在管理员携带有效 Admin Token 联调时返回
    const webhookPreview = isCallerAdmin
      ? buildMerchantWebhookEnvelope({
          order: { ...newOrder, status: 'PAID', paidAt: nowMs },
          connectedApp,
          fallbackCallbackUrl: serverRiskConfig.merchantCallbackUrl,
          fallbackSecretKey: serverRiskConfig.webhookSecretKey,
          nowMs,
        })
      : undefined;

    res.json({
      code: 0,
      msg: 'success',
      data: {
        orderId: newOrder.id,
        outTradeNo: newOrder.outTradeNo,
        appId: newOrder.appId,
        protocol: newOrder.protocol,
        signAlgorithm: signMode,
        channel: newOrder.channel,
        nominalAmountYuan: centsToYuan(newOrder.nominalAmountCents),
        actualPayAmountYuan: centsToYuan(newOrder.actualAmountCents),
        floatDeltaCents: newOrder.actualAmountCents - newOrder.nominalAmountCents,
        qrMatchType: newOrder.qrMatchType,
        qrPayloadUrl: newOrder.qrPayloadUrl,
        remarkCode: newOrder.remarkCode,
        attach: newOrder.attach,
        expiresAt: newOrder.expiresAt,
        cashierUrl: `/?orderId=${newOrder.id}`,
        signatureVerified: true,
        ...(isCallerAdmin
          ? {
              canonicalString,
              computedSign: expectedSign,
              webhookPreviewOnPaid: webhookPreview,
            }
          : {}),
      },
    });
  });

  // 4. Query Order Status - Public Desensitized Endpoint (GET /api/v1/orders/:id/status)
  // 严格脱敏：绝不返回 approvalToken、notifyUrl、appSecret 等敏感核销凭证
  app.get('/api/v1/orders/:id/status', (req, res) => {
    const order = serverOrders.find(
      (o) => o.id === req.params.id || o.outTradeNo === req.params.id
    );
    if (!order) {
      res.status(404).json({ code: 4004, msg: '订单不存在' });
      return;
    }
    res.json({
      code: 0,
      data: {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        status: order.status,
        nominalAmountYuan: centsToYuan(order.nominalAmountCents),
        actualPayAmountYuan: centsToYuan(order.actualAmountCents),
        paidAt: order.paidAt || null,
      },
    });
  });

  // 4b. Public Buyer Declaration: Mark Order as "I Have Paid" (POST /api/v1/orders/:id/mark-paid)
  // 状态机强约束：买家点击“我已支付”仅能将 PENDING_PAYMENT 转为 AWAITING_APPROVAL（触发管理员通知），绝不可直接转为 PAID
  app.post('/api/v1/orders/:id/mark-paid', (req, res) => {
    const order = serverOrders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ code: 4004, msg: '订单不存在' });
      return;
    }
    if (order.status !== 'PENDING_PAYMENT') {
      res.status(400).json({
        code: 4000,
        msg: `当前订单状态 (${order.status}) 不允许申报已支付`,
      });
      return;
    }
    serverOrders = serverOrders.map((o) =>
      o.id === order.id ? { ...o, status: 'AWAITING_APPROVAL' } : o
    );
    persistGatewayStateAtomically();
    res.json({
      code: 0,
      msg: '已提交付款申报，等待系统自动回调或管理员核实入账',
      data: { orderId: order.id, status: 'AWAITING_APPROVAL' },
    });
  });

  // 4c. Protected Order Approval Endpoint (POST /api/v1/orders/:id/approve)
  // 必须验证管理员会话 X-DoloPay-Admin-Token 或服务端私密签发的 approvalToken（常量时间比对）
  app.post('/api/v1/orders/:id/approve', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractRealClientIp(req);
    const order = serverOrders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ code: 4004, msg: '订单不存在' });
      return;
    }

    const adminToken = req.headers['x-dolopay-admin-token'] as string | undefined;
    const providedApprovalToken = String(req.body?.approvalToken || req.query?.token || '');

    const hasValidAdminSession = verifyAdminSessionToken(
      adminToken,
      serverRiskConfig.adminEmail,
      serverRiskConfig.webhookSecretKey,
      nowMs
    );
    const hasValidOrderApprovalToken =
      providedApprovalToken.length > 0 &&
      constantTimeEqual(providedApprovalToken, order.approvalToken);

    if (!hasValidAdminSession && !hasValidOrderApprovalToken) {
      appendAuditLog({
        id: `sec_${nowMs}_unauth_approve`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'SIGNATURE_REJECTED',
        clientIp,
        summary: `拦截未授权越权核销请求：攻击者尝试直接核销订单 ${order.id} (无有效 AdminToken 或 ApprovalToken)`,
      });
      persistGatewayStateAtomically();
      res.status(401).json({
        code: 4001,
        msg: '拒绝越权核销：缺少有效的管理员会话 Token 或服务端签名审批令牌',
      });
      return;
    }

    serverOrders = serverOrders.map((o) =>
      o.id === order.id
        ? {
            ...o,
            status: 'PAID',
            paidAt: nowMs,
            settlementMethod: 'EMAIL_TOKEN_APPROVAL',
            webhookStatus: 'DELIVERED',
            webhookAttempts: o.webhookAttempts + 1,
          }
        : o
    );
    appendAuditLog({
      id: `sec_${nowMs}_approve_ok`,
      timestamp: nowMs,
      level: 'INFO',
      eventType: 'MANUAL_RECONCILE',
      clientIp,
      summary: `订单 ${order.id} 通过服务端签名令牌校验完成核销入账`,
    });
    persistGatewayStateAtomically();
    res.json({
      code: 0,
      msg: '订单核销成功',
      data: { orderId: order.id, status: 'PAID', paidAt: nowMs },
    });
  });

  // 5. Mobile App Notification Listener Webhook (POST /api/v1/webhook/notify)
  app.post('/api/v1/webhook/notify', (req, res) => {
    const nowMs = Date.now();
    const clientIp = extractRealClientIp(req);
    const result = processWebhookNotification({
      payload: {
        ...req.body,
        deviceName: req.body?.deviceName || clientIp,
      },
      orders: serverOrders,
      riskConfig: serverRiskConfig,
      nowMs,
    });

    appendAuditLog(result.auditEvent);
    if (result.ok) {
      serverOrders = result.updatedOrders;
    }
    persistGatewayStateAtomically();

    res.status(result.ok ? 200 : 400).json({
      code: result.ok ? 0 : 4000,
      errorCode: result.errorCode || null,
      msg: result.message,
      matchedOrderId: result.matchedOrder?.id || null,
      auditEvent: result.auditEvent,
    });
  });

  // 6. Protected Admin State Sync & Persistence Endpoint (POST /api/v1/admin/persist)
  app.post('/api/v1/admin/persist', (req, res) => {
    const nowMs = Date.now();
    const token = req.headers['x-dolopay-admin-token'] as string | undefined;
    if (
      serverRiskConfig.requireAdminAuth &&
      !verifyAdminSessionToken(
        token,
        serverRiskConfig.adminEmail,
        serverRiskConfig.webhookSecretKey,
        nowMs
      )
    ) {
      res.status(401).json({
        code: 4001,
        msg: '未授权访问：缺少有效的 X-DoloPay-Admin-Token 会话凭证',
      });
      return;
    }

    const { riskConfig, connectedApps, notificationChannels, qrPool, orders, securityAuditLogs } =
      req.body || {};
    if (riskConfig) serverRiskConfig = { ...serverRiskConfig, ...riskConfig };
    if (Array.isArray(connectedApps)) serverConnectedApps = connectedApps;
    if (Array.isArray(notificationChannels)) serverNotificationChannels = notificationChannels;
    if (Array.isArray(qrPool)) serverQrPool = qrPool;
    if (Array.isArray(orders)) serverOrders = orders;
    if (Array.isArray(securityAuditLogs)) serverAuditLogs = securityAuditLogs;

    persistGatewayStateAtomically();
    res.json({
      code: 0,
      msg: '服务端原子持久化落盘成功 (.data/dolopay-store.json)',
      persistedAt: nowMs,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DoloPay Open Gateway Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

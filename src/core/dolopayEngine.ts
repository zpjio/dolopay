/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PluginStates } from './pluginRegistry';

export type PaymentChannel = 'alipay' | 'wechat' | 'unionpay';

export type OrderStatus =
  | 'PENDING_PAYMENT'    // 待买家扫码支付
  | 'AWAITING_APPROVAL'  // 买家已申报付款，等待飞书/邮件/钉钉审批
  | 'PAID'               // 已核销入账
  | 'EXPIRED'            // 超时过期
  | 'REJECTED';          // 管理员驳回

export type FloatStrategy =
  | 'EXACT_THEN_INCREMENT'
  | 'ALWAYS_INCREMENT'
  | 'EXACT_THEN_DECREMENT';

export type SettlementMethod =
  | 'APPROVAL_LINK'      // 飞书/邮件/钉钉签名确认页一键核销
  | 'MANUAL_ADMIN'       // 管理后台人工核销
  | 'ANDROID_WEBHOOK';   // 安卓通知栏监听自动核销

export type WebhookDeliveryStatus = 'IDLE' | 'DELIVERED' | 'FAILED' | 'SKIPPED';

export type IntegrationProtocol =
  | 'DOLOPAY_REST_V1'
  | 'EPAY_COMPAT'
  | 'STRIPE_WEBHOOK';

export type ApprovalNotifierId = 'email' | 'feishu' | 'dingtalk' | 'bark' | 'telegram';

export type SecurityAuditEventType =
  | 'SIGNATURE_REJECTED'
  | 'REPLAY_TIMESTAMP_EXPIRED'
  | 'DUPLICATE_TX_BLOCKED'
  | 'IP_RATE_LIMITED'
  | 'ADMIN_LOGIN_SUCCESS'
  | 'ADMIN_LOGIN_FAILED'
  | 'ADMIN_BOOTSTRAPPED'
  | 'WEBHOOK_VERIFIED'
  | 'ORDER_APPROVED'
  | 'ORDER_REJECTED'
  | 'NOTIFIER_DISPATCHED';

export interface SecurityAuditEvent {
  id: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'CRITICAL';
  eventType: SecurityAuditEventType;
  clientIp: string;
  summary: string;
}

export interface NotificationDeliveryLog {
  channel: ApprovalNotifierId;
  channelName: string;
  ok: boolean;
  skipped?: boolean;
  message: string;
  sentAt: number;
}

export interface EmailSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  adminTo: string;
  sendBuyerReceipt: boolean;
}

export interface FeishuNotifierConfig {
  enabled: boolean;
  webhookUrl: string;
  secret: string;
}

export interface DingTalkNotifierConfig {
  enabled: boolean;
  webhookUrl: string;
  secret: string;
}

export interface BarkNotifierConfig {
  pushUrl: string;
  group: string;
}

export interface TelegramNotifierConfig {
  botToken: string;
  chatId: string;
}

export interface QrChannelSlot {
  channel: PaymentChannel;
  enabled: boolean;
  displayName: string;
  accountMask: string;
  paymentTip: string;
  uploadedFileName?: string;
  updatedAt: number;
}

export interface ConnectedApp {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  protocol: IntegrationProtocol;
  notifyUrl: string;
  returnUrl: string;
  enabled: boolean;
  totalOrders: number;
  totalPaidCents: number;
  createdAt: number;
}

export interface GatewaySettings {
  siteTitle: string;
  publicBaseUrl: string;
  orderTtlSeconds: number;
  maxPendingPerIp: number;
  rateLimitPerMinute: number;
  // Optional cent-float settings (active when plugins.centFloat is true)
  floatStrategy: FloatStrategy;
  maxFloatSteps: number;
  // Core Default Approval Channels (simultaneous multi-channel supported)
  email: EmailSmtpConfig;
  feishu: FeishuNotifierConfig;
  dingtalk: DingTalkNotifierConfig;
  // Optional Extension Notifier Configs
  bark: BarkNotifierConfig;
  telegram: TelegramNotifierConfig;
  // Optional Android Listener Webhook Config
  androidWebhookSecret: string;
  webhookReplayWindowSeconds: number;
  // Modular Plugin Toggles
  plugins: PluginStates;
}

export interface DoloPayOrder {
  id: string;
  outTradeNo: string;
  appId?: string;
  appName?: string;
  protocol?: IntegrationProtocol;
  attach?: string;
  notifyUrl?: string;
  returnUrl?: string;
  productTitle: string;
  channel: PaymentChannel;
  nominalAmountCents: number;
  actualAmountCents: number;
  remarkCode: string;
  payerNickName: string;
  payerEmail: string;
  payerMessage: string;
  clientIp: string;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  rejectedAt?: number;
  settlementMethod?: SettlementMethod;
  approvalToken: string;
  notificationLogs: NotificationDeliveryLog[];
  lastNotifiedAt?: number;
  notifyCount?: number;
  webhookStatus: WebhookDeliveryStatus;
  webhookAttempts: number;
  webhookLastResponse?: string;
  deviceTransactionId?: string;
  isDemo?: boolean;
}

export interface WebhookNotifyPayload {
  channel: PaymentChannel;
  amountYuan: string;
  timestamp: number;
  deviceTxId: string;
  deviceName?: string;
  sign: string;
}

export interface AllocateAmountResult {
  ok: boolean;
  actualAmountCents?: number;
  floatDeltaCents?: number;
  errorCode?: 'INVALID_AMOUNT' | 'IP_RATE_LIMITED' | 'AMOUNT_POOL_EXHAUSTED';
  errorMessage?: string;
}

export interface DashboardMetrics {
  paidGmvCents: number;
  paidCount: number;
  totalOrdersCount: number;
  pendingPaymentCount: number;
  pendingApprovalCount: number;
  expiredCount: number;
  conversionRatePercent: number;
  channelStats: Record<
    PaymentChannel,
    {
      paidCents: number;
      paidCount: number;
    }
  >;
}

export interface MerchantWebhookEnvelope {
  targetUrl: string;
  protocol: IntegrationProtocol;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, string | number>;
  canonicalString: string;
  signature: string;
  signAlgorithm: 'HMAC-SHA256' | 'MD5';
}

export function yuanToCents(yuanInput: string | number): number {
  const cleaned = String(yuanInput).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return NaN;
  }
  const [intPart, decPart = ''] = cleaned.split('.');
  const paddedDec = (decPart + '00').slice(0, 2);
  return parseInt(intPart, 10) * 100 + parseInt(paddedDec, 10);
}

export function centsToYuan(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${yuan}.${String(rem).padStart(2, '0')}`;
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Bytes(msgBytes: Uint8Array): Uint8Array {
  const bitLen = msgBytes.length * 8;
  const padLen = (msgBytes.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msgBytes);
  padded[msgBytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(input)));
}

export function hmacSha256Hex(message: string, secretKey: string): string {
  const blockSize = 64;
  let keyBytes = utf8ToBytes(secretKey);
  if (keyBytes.length > blockSize) {
    keyBytes = sha256Bytes(keyBytes);
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const k = i < keyBytes.length ? keyBytes[i] : 0;
    oKeyPad[i] = k ^ 0x5c;
    iKeyPad[i] = k ^ 0x36;
  }

  const msgBytes = utf8ToBytes(message);
  const innerInput = new Uint8Array(blockSize + msgBytes.length);
  innerInput.set(iKeyPad, 0);
  innerInput.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(innerInput);

  const outerInput = new Uint8Array(blockSize + innerHash.length);
  outerInput.set(oKeyPad, 0);
  outerInput.set(innerHash, blockSize);
  return bytesToHex(sha256Bytes(outerInput));
}

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function md5Hex(input: string): string {
  const msgBytes = utf8ToBytes(input);
  const bitLen = msgBytes.length * 8;
  const padLen = (msgBytes.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msgBytes);
  padded[msgBytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLen >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padLen; offset += 64) {
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const m = view.getUint32(offset + g * 4, true);
      const temp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i] + m) >>> 0;
      B = (B + rotl32(sum, MD5_S[i])) >>> 0;
      A = temp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return bytesToHex(out);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB);
  let diff = lenA ^ lenB;
  for (let i = 0; i < maxLen; i++) {
    const codeA = i < lenA ? a.charCodeAt(i) : 0;
    const codeB = i < lenB ? b.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

export function computeDoloPaySignature(
  channel: PaymentChannel,
  amountYuan: string,
  timestamp: number,
  secretKey: string
): string {
  const normalizedAmount = centsToYuan(yuanToCents(amountYuan));
  const canonical = `channel=${channel}&amount=${normalizedAmount}&timestamp=${timestamp}`;
  return hmacSha256Hex(canonical, secretKey);
}

export function computeCanonicalOpenApiSign(
  params: Record<string, string | number | undefined>,
  appSecret: string,
  mode: 'HMAC-SHA256' | 'MD5' = 'HMAC-SHA256'
): { canonicalString: string; sign: string } {
  const keys = Object.keys(params)
    .filter(
      (k) =>
        k !== 'sign' &&
        k !== 'sign_type' &&
        params[k] !== undefined &&
        String(params[k]).trim() !== ''
    )
    .sort();

  const pairs = keys.map((k) => `${k}=${String(params[k]).trim()}`);
  const baseQuery = pairs.join('&');

  if (mode === 'MD5') {
    const epayString = `${baseQuery}${appSecret}`;
    return {
      canonicalString: `${baseQuery}&key=${appSecret}`,
      sign: md5Hex(epayString),
    };
  }

  const canonicalString = `${baseQuery}&key=${appSecret}`;
  return {
    canonicalString,
    sign: hmacSha256Hex(canonicalString, appSecret),
  };
}

export function signAdminSessionToken(
  subject: string,
  issuedAtMs: number,
  expiresAtMs: number,
  secretKey: string
): string {
  const payload = `${subject}|${issuedAtMs}|${expiresAtMs}`;
  const sig = hmacSha256Hex(payload, secretKey);
  return `dptok_${issuedAtMs}_${expiresAtMs}_${sig.slice(0, 32)}`;
}

export function verifyAdminSessionToken(
  token: string | undefined | null,
  subject: string,
  secretKey: string,
  nowMs: number
): boolean {
  if (!token || !token.startsWith('dptok_')) return false;
  const parts = token.split('_');
  if (parts.length !== 4) return false;
  const issuedAtMs = Number(parts[1]);
  const expiresAtMs = Number(parts[2]);
  const providedSig = parts[3];
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return false;
  if (nowMs > expiresAtMs) return false;

  const expectedToken = signAdminSessionToken(subject, issuedAtMs, expiresAtMs, secretKey);
  const expectedSig = expectedToken.split('_')[3];
  return constantTimeEqual(providedSig, expectedSig);
}

export function signOrderApprovalToken(
  orderId: string,
  issuedAtMs: number,
  expiresAtMs: number,
  secretKey: string
): string {
  const payload = `approve|${orderId}|${issuedAtMs}|${expiresAtMs}`;
  const sig = hmacSha256Hex(payload, secretKey);
  return `dpap_${issuedAtMs}_${expiresAtMs}_${sig.slice(0, 32)}`;
}

export function verifyOrderApprovalToken(
  token: string | undefined | null,
  orderId: string,
  secretKey: string,
  nowMs: number
): boolean {
  if (!token || !token.startsWith('dpap_')) return false;
  const parts = token.split('_');
  if (parts.length !== 4) return false;
  const issuedAtMs = Number(parts[1]);
  const expiresAtMs = Number(parts[2]);
  const providedSig = parts[3];
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return false;
  if (nowMs > expiresAtMs) return false;

  const expected = signOrderApprovalToken(orderId, issuedAtMs, expiresAtMs, secretKey);
  const expectedSig = expected.split('_')[3];
  return constantTimeEqual(providedSig, expectedSig);
}

/**
 * 校验订单上存储的审批 Token（常数时间比对 + 内嵌过期时间戳校验）
 */
export function isOrderApprovalTokenValid(
  providedToken: string | undefined | null,
  storedToken: string | undefined | null,
  nowMs: number
): boolean {
  if (!providedToken || !storedToken) return false;
  if (!constantTimeEqual(providedToken, storedToken)) return false;
  if (!providedToken.startsWith('dpap_')) return false;
  const parts = providedToken.split('_');
  if (parts.length !== 4) return false;
  const issuedAtMs = Number(parts[1]);
  const expiresAtMs = Number(parts[2]);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return false;
  return nowMs <= expiresAtMs;
}

export function maskSensitiveSecret(secret: string): string {
  if (!secret) return '未配置';
  if (secret.length <= 10) return '••••••••';
  return `${secret.slice(0, 6)}••••••••${secret.slice(-4)}`;
}

export function buildMerchantWebhookEnvelope(params: {
  order: DoloPayOrder;
  connectedApp?: ConnectedApp;
  fallbackCallbackUrl: string;
  fallbackSecretKey: string;
  nowMs: number;
}): MerchantWebhookEnvelope {
  const { order, connectedApp, fallbackCallbackUrl, fallbackSecretKey, nowMs } = params;
  const protocol: IntegrationProtocol =
    order.protocol || connectedApp?.protocol || 'DOLOPAY_REST_V1';
  const targetUrl = order.notifyUrl || connectedApp?.notifyUrl || fallbackCallbackUrl;
  const secret = connectedApp?.appSecret || fallbackSecretKey;
  const appId = order.appId || connectedApp?.appId || 'app_default';
  const ts = order.paidAt || nowMs;

  if (protocol === 'EPAY_COMPAT') {
    const epayParams: Record<string, string | number> = {
      pid: appId,
      trade_no: order.id,
      out_trade_no: order.outTradeNo,
      type: order.channel === 'wechat' ? 'wxpay' : order.channel,
      name: order.productTitle,
      money: centsToYuan(order.actualAmountCents),
      trade_status: order.status === 'PAID' ? 'TRADE_SUCCESS' : order.status,
      param: order.attach || '',
    };
    const { canonicalString, sign } = computeCanonicalOpenApiSign(epayParams, secret, 'MD5');
    return {
      targetUrl,
      protocol,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'DoloPay-Webhook/3.0 (EPay-Compat-MD5)',
        'X-DoloPay-Delivery-Id': `deliv_${order.id}_${order.webhookAttempts + 1}`,
      },
      body: {
        ...epayParams,
        sign,
        sign_type: 'MD5',
      },
      canonicalString,
      signature: sign,
      signAlgorithm: 'MD5',
    };
  }

  if (protocol === 'STRIPE_WEBHOOK') {
    const bodyObj: Record<string, string | number> = {
      id: `evt_${order.id.toLowerCase()}`,
      type: order.status === 'PAID' ? 'payment_intent.succeeded' : 'payment_intent.updated',
      app_id: appId,
      order_id: order.id,
      out_trade_no: order.outTradeNo,
      channel: order.channel,
      nominal_amount_cents: order.nominalAmountCents,
      actual_amount_cents: order.actualAmountCents,
      actual_amount_yuan: centsToYuan(order.actualAmountCents),
      attach: order.attach || '',
      created: Math.floor(ts / 1000),
    };
    const signedPayload = `${Math.floor(ts / 1000)}.${JSON.stringify(bodyObj)}`;
    const sig = hmacSha256Hex(signedPayload, secret);
    return {
      targetUrl,
      protocol,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DoloPay-Signature': `t=${Math.floor(ts / 1000)},v1=${sig}`,
        'Idempotency-Key': `idem_${order.id}_${order.status}`,
      },
      body: bodyObj,
      canonicalString: signedPayload,
      signature: sig,
      signAlgorithm: 'HMAC-SHA256',
    };
  }

  const v1Params: Record<string, string | number> = {
    appId,
    orderId: order.id,
    outTradeNo: order.outTradeNo,
    channel: order.channel,
    nominalAmountCents: order.nominalAmountCents,
    actualAmountCents: order.actualAmountCents,
    actualAmountYuan: centsToYuan(order.actualAmountCents),
    remarkCode: order.remarkCode,
    attach: order.attach || '',
    status: order.status,
    timestamp: ts,
  };
  const { canonicalString, sign } = computeCanonicalOpenApiSign(v1Params, secret, 'HMAC-SHA256');

  return {
    targetUrl,
    protocol: 'DOLOPAY_REST_V1',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DoloPay-App-Id': appId,
      'X-DoloPay-Timestamp': String(ts),
      'X-DoloPay-Signature': sign,
      'X-DoloPay-Sign-Algorithm': 'HMAC-SHA256',
      'Idempotency-Key': `idem_${order.id}_${order.status}`,
    },
    body: {
      ...v1Params,
      sign,
    },
    canonicalString,
    signature: sign,
    signAlgorithm: 'HMAC-SHA256',
  };
}

export function isOrderHoldingAmountLock(order: DoloPayOrder, nowMs: number): boolean {
  if (order.status === 'PENDING_PAYMENT') {
    return order.expiresAt > nowMs;
  }
  if (order.status === 'AWAITING_APPROVAL') {
    return order.expiresAt + 120_000 > nowMs;
  }
  return false;
}

export function sweepExpiredOrders(
  orders: DoloPayOrder[],
  nowMs: number
): {
  updatedOrders: DoloPayOrder[];
  expiredOrderIds: string[];
} {
  const expiredOrderIds: string[] = [];
  const updatedOrders = orders.map((order) => {
    if (order.status === 'PENDING_PAYMENT' && order.expiresAt <= nowMs) {
      expiredOrderIds.push(order.id);
      return {
        ...order,
        status: 'EXPIRED' as OrderStatus,
      };
    }
    return order;
  });
  return { updatedOrders, expiredOrderIds };
}

/**
 * 分配实付金额：
 * - 默认模式（enableCentFloat=false）：始终返回原价（不改买家金额），使用 6 位付款口令核对
 * - 可选插件模式（enableCentFloat=true）：按分位防冲突算法动态分配唯一实付金额
 */
export function allocatePayableAmount(params: {
  channel: PaymentChannel;
  nominalAmountCents: number;
  clientIp: string;
  existingOrders: DoloPayOrder[];
  maxPendingPerIp: number;
  enableCentFloat: boolean;
  floatStrategy?: FloatStrategy;
  maxFloatSteps?: number;
  nowMs: number;
}): AllocateAmountResult {
  const {
    channel,
    nominalAmountCents,
    clientIp,
    existingOrders,
    maxPendingPerIp,
    enableCentFloat,
    floatStrategy = 'EXACT_THEN_INCREMENT',
    maxFloatSteps = 15,
    nowMs,
  } = params;

  if (!Number.isInteger(nominalAmountCents) || nominalAmountCents <= 0 || nominalAmountCents > 5_000_000) {
    return {
      ok: false,
      errorCode: 'INVALID_AMOUNT',
      errorMessage: '请输入有效的收款金额（0.01 ~ 50,000.00 元）',
    };
  }

  const activeFromIp = existingOrders.filter(
    (o) => o.clientIp === clientIp && isOrderHoldingAmountLock(o, nowMs)
  );
  if (activeFromIp.length >= Math.max(1, maxPendingPerIp)) {
    return {
      ok: false,
      errorCode: 'IP_RATE_LIMITED',
      errorMessage: `当前设备待支付订单已达上限 (${maxPendingPerIp} 笔)，请完成支付或稍后再试`,
    };
  }

  if (!enableCentFloat) {
    return {
      ok: true,
      actualAmountCents: nominalAmountCents,
      floatDeltaCents: 0,
    };
  }

  const occupiedCents = new Set<number>();
  for (const order of existingOrders) {
    if (order.channel === channel && isOrderHoldingAmountLock(order, nowMs)) {
      occupiedCents.add(order.actualAmountCents);
    }
  }

  const candidates: number[] = [];
  const maxSteps = Math.max(1, maxFloatSteps);
  if (floatStrategy === 'EXACT_THEN_INCREMENT') {
    for (let step = 0; step <= maxSteps; step++) candidates.push(nominalAmountCents + step);
  } else if (floatStrategy === 'ALWAYS_INCREMENT') {
    for (let step = 1; step <= maxSteps; step++) candidates.push(nominalAmountCents + step);
  } else {
    for (let step = 0; step <= maxSteps; step++) {
      const c = nominalAmountCents - step;
      if (c >= 1) candidates.push(c);
    }
  }

  for (const candidateCents of candidates) {
    if (!occupiedCents.has(candidateCents)) {
      return {
        ok: true,
        actualAmountCents: candidateCents,
        floatDeltaCents: candidateCents - nominalAmountCents,
      };
    }
  }

  return {
    ok: false,
    errorCode: 'AMOUNT_POOL_EXHAUSTED',
    errorMessage: `当前金额区间 (${centsToYuan(nominalAmountCents)} 元) 并发订单已满，请稍候重试`,
  };
}

/**
 * 可选扩展：处理安卓通知栏监听 Webhook 自动核销
 */
export function processWebhookNotification(params: {
  payload: WebhookNotifyPayload;
  orders: DoloPayOrder[];
  androidWebhookSecret: string;
  webhookReplayWindowSeconds: number;
  nowMs: number;
}): {
  ok: boolean;
  matchedOrder?: DoloPayOrder;
  updatedOrders: DoloPayOrder[];
  errorCode?:
    | 'INVALID_SIGNATURE'
    | 'TIMESTAMP_EXPIRED'
    | 'DUPLICATE_TX_ID'
    | 'NO_MATCHING_ORDER'
    | 'INVALID_AMOUNT';
  message: string;
  auditEvent: SecurityAuditEvent;
} {
  const { payload, orders, androidWebhookSecret, webhookReplayWindowSeconds, nowMs } = params;
  const amountCents = yuanToCents(payload.amountYuan);

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'INVALID_AMOUNT',
      message: `Webhook 金额格式非法: ${payload.amountYuan}`,
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'WARN',
        eventType: 'SIGNATURE_REJECTED',
        clientIp: payload.deviceName || 'android-listener',
        summary: `拦截非法金额格式 Webhook (${payload.amountYuan})`,
      },
    };
  }

  const maxSkewSeconds = Math.max(30, webhookReplayWindowSeconds || 300);
  const skewSeconds = Math.round(Math.abs(nowMs - Number(payload.timestamp)) / 1000);
  if (!Number.isFinite(payload.timestamp) || skewSeconds > maxSkewSeconds) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'TIMESTAMP_EXPIRED',
      message: `报文时间戳偏差 ${skewSeconds}s 超出允许窗口 (±${maxSkewSeconds}s)`,
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'REPLAY_TIMESTAMP_EXPIRED',
        clientIp: payload.deviceName || 'android-listener',
        summary: `拦截过期时间戳重放请求 (${payload.channel} ¥${centsToYuan(amountCents)})`,
      },
    };
  }

  const expectedSign = computeDoloPaySignature(
    payload.channel,
    centsToYuan(amountCents),
    payload.timestamp,
    androidWebhookSecret
  );

  if (!constantTimeEqual(payload.sign, expectedSign)) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'INVALID_SIGNATURE',
      message: 'HMAC-SHA256 签名校验未通过',
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'SIGNATURE_REJECTED',
        clientIp: payload.deviceName || 'android-listener',
        summary: `拦截伪造安卓监听签名 (${payload.channel} ¥${centsToYuan(amountCents)})`,
      },
    };
  }

  if (payload.deviceTxId) {
    const existingDuplicate = orders.find(
      (o) => o.deviceTransactionId === payload.deviceTxId && o.status === 'PAID'
    );
    if (existingDuplicate) {
      return {
        ok: false,
        matchedOrder: existingDuplicate,
        updatedOrders: orders,
        errorCode: 'DUPLICATE_TX_ID',
        message: `流水号 ${payload.deviceTxId} 已核销于订单 ${existingDuplicate.id}，已幂等忽略`,
        auditEvent: {
          id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowMs,
          level: 'WARN',
          eventType: 'DUPLICATE_TX_BLOCKED',
          clientIp: payload.deviceName || 'android-listener',
          summary: `幂等拦截重复设备通知流水号 ${payload.deviceTxId}`,
        },
      };
    }
  }

  const candidates = orders
    .filter(
      (o) =>
        o.channel === payload.channel &&
        o.actualAmountCents === amountCents &&
        isOrderHoldingAmountLock(o, nowMs)
    )
    .sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'AWAITING_APPROVAL' ? -1 : 1;
      }
      return b.createdAt - a.createdAt;
    });

  const target = candidates[0];
  if (!target) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'NO_MATCHING_ORDER',
      message: `未找到渠道 [${payload.channel}] 金额 ¥${centsToYuan(amountCents)} 的待付订单`,
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'WARN',
        eventType: 'WEBHOOK_VERIFIED',
        clientIp: payload.deviceName || 'android-listener',
        summary: `收到合法安卓监听通知 (${payload.channel} ¥${centsToYuan(amountCents)})，无匹配待付订单`,
      },
    };
  }

  const settledOrder: DoloPayOrder = {
    ...target,
    status: 'PAID',
    paidAt: nowMs,
    settlementMethod: 'ANDROID_WEBHOOK',
    deviceTransactionId: payload.deviceTxId,
  };

  const updatedOrders = orders.map((o) => (o.id === target.id ? settledOrder : o));

  return {
    ok: true,
    matchedOrder: settledOrder,
    updatedOrders,
    message: `订单 ${settledOrder.id} (¥${centsToYuan(amountCents)}) 已通过安卓通知监听自动核销`,
    auditEvent: {
      id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowMs,
      level: 'INFO',
      eventType: 'WEBHOOK_VERIFIED',
      clientIp: payload.deviceName || 'android-listener',
      summary: `订单 ${settledOrder.id} (¥${centsToYuan(amountCents)}) 通过安卓监听自动核销入账`,
    },
  };
}

export function checkSlidingWindowRateLimit(params: {
  bucketMap: Map<string, number[]>;
  clientIp: string;
  limitPerMinute: number;
  nowMs: number;
}): { allowed: boolean; currentCount: number; retryAfterSeconds: number } {
  const { bucketMap, clientIp, limitPerMinute, nowMs } = params;
  const windowStart = nowMs - 60_000;
  const history = (bucketMap.get(clientIp) || []).filter((ts) => ts > windowStart);

  if (history.length >= limitPerMinute) {
    const oldest = history[0] || nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - nowMs) / 1000));
    bucketMap.set(clientIp, history);
    return {
      allowed: false,
      currentCount: history.length,
      retryAfterSeconds,
    };
  }

  history.push(nowMs);
  bucketMap.set(clientIp, history);
  return {
    allowed: true,
    currentCount: history.length,
    retryAfterSeconds: 0,
  };
}

export function calculateDashboardMetrics(orders: DoloPayOrder[], _nowMs?: number): DashboardMetrics {
  const channelStats: DashboardMetrics['channelStats'] = {
    alipay: { paidCents: 0, paidCount: 0 },
    wechat: { paidCents: 0, paidCount: 0 },
    unionpay: { paidCents: 0, paidCount: 0 },
  };

  let paidGmvCents = 0;
  let paidCount = 0;
  let pendingPaymentCount = 0;
  let pendingApprovalCount = 0;
  let expiredCount = 0;

  for (const order of orders) {
    if (order.status === 'PENDING_PAYMENT') pendingPaymentCount++;
    if (order.status === 'AWAITING_APPROVAL') pendingApprovalCount++;
    if (order.status === 'EXPIRED') expiredCount++;
    if (order.status === 'PAID') {
      paidGmvCents += order.actualAmountCents;
      paidCount++;
      channelStats[order.channel].paidCents += order.actualAmountCents;
      channelStats[order.channel].paidCount++;
    }
  }

  const conversionRatePercent =
    orders.length > 0 ? Math.round((paidCount / orders.length) * 1000) / 10 : 0;

  return {
    paidGmvCents,
    paidCount,
    totalOrdersCount: orders.length,
    pendingPaymentCount,
    pendingApprovalCount,
    expiredCount,
    conversionRatePercent,
    channelStats,
  };
}

export type PaymentChannel = 'alipay' | 'wechat' | 'unionpay';

export type OrderStatus =
  | 'PENDING_PAYMENT'    // 待支付（占用唯一金额锁）
  | 'AWAITING_APPROVAL'  // 已标记支付，待DoloPay邮件/后台核销
  | 'PAID'               // 已到账核销（金额锁已释放）
  | 'EXPIRED'            // 超时过期（金额锁已自动回收）
  | 'REJECTED';          // 审核驳回/恶意假付

export type FloatStrategy =
  | 'EXACT_THEN_INCREMENT' // 优先原价，冲突时向上 +0.01 递增
  | 'ALWAYS_INCREMENT'     // 始终从 +0.01 起递增（区分原价）
  | 'EXACT_THEN_DECREMENT';// 优先原价，冲突时向下 -0.01 随机立减

export type SettlementMethod =
  | 'AUTO_WEBHOOK'         // 移动端通知监听 / Webhook 自动回调
  | 'EMAIL_TOKEN_APPROVAL' // DoloPay 邮件链接/后台一键核销
  | 'MANUAL_RECONCILE';    // 异常掉单人工补单

export type WebhookDeliveryStatus = 'IDLE' | 'DELIVERED' | 'FAILED_RETRYING' | 'DEAD_LETTER';

export type IntegrationProtocol =
  | 'DOLOPAY_REST_V1'// DoloPay 标准 JSON Open API (HMAC-SHA256 签名 + 幂等头)
  | 'EPAY_COMPAT'    // 彩虹易支付兼容协议 (pid + key 字典序标准 MD5 签名，适配发卡网/面板)
  | 'STRIPE_WEBHOOK';// Stripe 风格 Webhook (X-DoloPay-Signature: t=...,v1=... HMAC-SHA256)

export type SecurityAuditEventType =
  | 'SIGNATURE_REJECTED'
  | 'REPLAY_TIMESTAMP_EXPIRED'
  | 'DUPLICATE_TX_BLOCKED'
  | 'IP_RATE_LIMITED'
  | 'ADMIN_LOGIN_SUCCESS'
  | 'ADMIN_LOGIN_FAILED'
  | 'WEBHOOK_VERIFIED'
  | 'MANUAL_RECONCILE';

export interface SecurityAuditEvent {
  id: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'CRITICAL';
  eventType: SecurityAuditEventType;
  clientIp: string;
  summary: string;
}

export interface ConnectedApp {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  protocol: IntegrationProtocol;
  notifyUrl: string;
  returnUrl: string;
  ipWhitelist: string; // 逗号分隔或 *
  enabled: boolean;
  totalOrders: number;
  totalPaidCents: number;
  webhookSuccessRate: number;
  createdAt: number;
}

export interface NotificationChannelConfig {
  id: string;
  type: 'feishu' | 'dingtalk' | 'wecom' | 'bark' | 'telegram';
  name: string;
  endpointMask: string;
  enabled: boolean;
  events: ('ORDER_CREATED' | 'AWAITING_APPROVAL' | 'ORDER_PAID' | 'WEBHOOK_FAILED')[];
}

export interface QrCodeItem {
  id: string;
  channel: PaymentChannel;
  type: 'UNIVERSAL' | 'FIXED';
  fixedAmountCents?: number; // 仅 FIXED 固码有效
  label: string;
  accountMask: string;
  qrPayloadUrl: string;
  enabled: boolean;
  todayCount: number;
  todayAmountCents: number;
  createdAt: number;
}

export interface SystemRiskConfig {
  floatStrategy: FloatStrategy;
  maxFloatSteps: number;               // 最大浮动步数，例如 15 表示最多浮动 ±0.15 元
  orderTtlSeconds: number;             // 订单金额锁存活时长（秒），默认 300 秒（5分钟）
  maxPendingPerIp: number;             // 单 IP 最大同时待支付订单数（防恶意占满金额池）
  webhookReplayWindowSeconds: number;  // Webhook 时间戳防重放窗口（秒），默认 300 秒（±5分钟）
  rateLimitPerMinute: number;          // 单 IP 每分钟 API 请求速率上限，默认 30 次/分钟
  requireAdminAuth: boolean;           // 是否启用管理后台口令与会话 Token 门禁保护
  adminPassword: string;               // 管理员访问口令（生产环境由 DOLOPAY_ADMIN_PASSWORD 注入）
  webhookSecretKey: string;            // App 监听端与服务端 HMAC-SHA256 通信密钥
  merchantCallbackUrl: string;         // 默认下游业务系统异步通知地址
  adminEmail: string;                  // 接收 DoloPay 快捷审批通知的管理员邮箱
  autoApproveTrustedTest: boolean;     // 是否开启沙盒免审体验模式
}

export interface DoloPayOrder {
  id: string;                    // 订单号，例如 DP202611158891
  outTradeNo: string;            // 商户外部单号
  appId?: string;                // 接入来源应用 AppID
  appName?: string;              // 接入来源应用名称
  protocol?: IntegrationProtocol;// 接入协议类型
  attach?: string;               // 外部系统自定义透传参数 (如 userId=1024&plan=pro)
  notifyUrl?: string;            // 订单级异步回调地址
  returnUrl?: string;            // 订单级同步跳转地址
  productTitle: string;          // 商品/赞赏名称
  channel: PaymentChannel;
  nominalAmountCents: number;    // 订单原始标称金额（分）
  actualAmountCents: number;     // 实际唯一锁定应付金额（分）
  remarkCode: string;            // 6位防伪付款备注口令
  payerNickName: string;         // 付款人昵称/标识
  payerEmail: string;            // 付款人接收通知邮箱
  payerMessage: string;          // 留言内容
  clientIp: string;              // 发起请求真实 IP
  status: OrderStatus;
  qrCodeId: string;
  qrMatchType: 'FIXED_EXACT' | 'UNIVERSAL_DYNAMIC';
  qrPayloadUrl: string;
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  settlementMethod?: SettlementMethod;
  approvalToken: string;         // DoloPay 邮件一键通过/驳回专属 HMAC 签名 Token
  webhookStatus: WebhookDeliveryStatus;
  webhookAttempts: number;
  webhookLastResponse?: string;
  deviceTransactionId?: string;  // 监听端上报的流水号/通知指纹
}

export interface AmountLockSlot {
  channel: PaymentChannel;
  amountCents: number;
  orderId: string;
  expiresAt: number;
}

export interface WebhookNotifyPayload {
  channel: PaymentChannel;
  amountYuan: string;            // 如 "10.01"
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
  todayPaidGmvCents: number;
  todayPaidCount: number;
  totalOrdersCount: number;
  activeLocksCount: number;
  pendingApprovalCount: number;
  expiredCount: number;
  conversionRatePercent: number;
  channelStats: Record<PaymentChannel, {
    paidCents: number;
    paidCount: number;
    activeLocks: number;
  }>;
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
  retryScheduleSeconds: number[];
}

export const WEBHOOK_RETRY_BACKOFF_SECONDS = [0, 15, 60, 300, 900];

/**
 * 将元字符串或数字安全转换为整数分，杜绝 IEEE 754 浮点数精度误差
 */
export function yuanToCents(yuanInput: string | number): number {
  const cleaned = String(yuanInput).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return NaN;
  }
  const [intPart, decPart = ''] = cleaned.split('.');
  const paddedDec = (decPart + '00').slice(0, 2);
  const cents = parseInt(intPart, 10) * 100 + parseInt(paddedDec, 10);
  return cents;
}

/**
 * 将整数分格式化为标准两位小数人民币字符串 (如 1001 -> "10.01")
 */
export function centsToYuan(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${yuan}.${String(rem).padStart(2, '0')}`;
}

/**
 * UTF-8 编码辅助函数（前后端同构）
 */
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

/**
 * 标准 FIPS 180-4 SHA-256 算法（纯 TypeScript 同构实现，与 Node.js crypto.createHash('sha256') 100% 字节级一致）
 */
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
  const padLen = ((msgBytes.length + 9 + 63) & ~63);
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

/**
 * 标准 RFC 2104 HMAC-SHA256 签名函数（与 Node.js crypto.createHmac('sha256', key) 100% 一致）
 */
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

/**
 * 标准 RFC 1321 MD5 算法（专为彩虹易支付 EPAY_COMPAT 协议 32位签名兼容设计，与 PHP md5() 100% 一致）
 */
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
  const padLen = ((msgBytes.length + 9 + 63) & ~63);
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

/**
 * 防时序攻击的常量时间字符串比较函数 (Constant-Time String Comparison)
 */
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

/**
 * 兼容旧调用的同步确定性哈希入口（内部已全面升级为标准 SHA-256）
 */
export function deterministicHashHex(raw: string): string {
  return sha256Hex(raw);
}

/**
 * 移动端收款通知上报签名函数（标准 RFC 2104 HMAC-SHA256）
 */
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

/**
 * 开放平台通用字典序签名算法（支持标准 HMAC-SHA256 与彩虹易支付标准 MD5 双模兼容）
 * 过滤空值与 sign/sign_type 字段，按参数名 ASCII 升序拼接 k1=v1&k2=v2...
 */
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
    // 彩虹易支付标准 MD5 签名格式：k1=v1&k2=v2... + appSecret
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

/**
 * 签发与校验管理员会话 Token (HMAC-SHA256 签名保护)
 */
export function signAdminSessionToken(
  adminEmail: string,
  issuedAtMs: number,
  expiresAtMs: number,
  secretKey: string
): string {
  const payload = `${adminEmail}|${issuedAtMs}|${expiresAtMs}`;
  const sig = hmacSha256Hex(payload, secretKey);
  return `dptok_${issuedAtMs}_${expiresAtMs}_${sig.slice(0, 32)}`;
}

export function verifyAdminSessionToken(
  token: string | undefined | null,
  adminEmail: string,
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

  const expectedToken = signAdminSessionToken(adminEmail, issuedAtMs, expiresAtMs, secretKey);
  const expectedSig = expectedToken.split('_')[3];
  return constantTimeEqual(providedSig, expectedSig);
}

/**
 * 敏感密钥掩码脱敏展示辅助函数
 */
export function maskSensitiveSecret(secret: string): string {
  if (!secret || secret.length <= 10) return '••••••••';
  return `${secret.slice(0, 8)}••••••••••••${secret.slice(-4)}`;
}

/**
 * 构建向外部业务系统投递的标准异步回调报文（支持 DoloPay REST v1 / 彩虹易支付兼容 MD5 / Stripe 风格 HMAC-SHA256）
 */
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
  const targetUrl =
    order.notifyUrl || connectedApp?.notifyUrl || fallbackCallbackUrl;
  const secret = connectedApp?.appSecret || fallbackSecretKey;
  const appId = order.appId || connectedApp?.appId || 'app_default';
  const ts = order.paidAt || nowMs;

  if (protocol === 'EPAY_COMPAT') {
    // 彩虹易支付标准回调载荷（采用标准 RFC 1321 MD5 32位签名，无缝对接独角数卡、鲸发卡、WHMCS、V2Board）
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
        'User-Agent': 'DoloPay-Webhook/2.5 (EPay-Compat-MD5)',
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
      retryScheduleSeconds: WEBHOOK_RETRY_BACKOFF_SECONDS,
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
      retryScheduleSeconds: WEBHOOK_RETRY_BACKOFF_SECONDS,
    };
  }

  // 默认 DoloPay REST v1 标准协议 (HMAC-SHA256)
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
    retryScheduleSeconds: WEBHOOK_RETRY_BACKOFF_SECONDS,
  };
}

/**
 * 判断订单当前是否仍然占用唯一金额锁
 */
export function isOrderHoldingAmountLock(order: DoloPayOrder, nowMs: number): boolean {
  if (order.status === 'PENDING_PAYMENT') {
    return order.expiresAt > nowMs;
  }
  if (order.status === 'AWAITING_APPROVAL') {
    return order.expiresAt + 120_000 > nowMs;
  }
  return false;
}

/**
 * 获取当前所有活跃的金额锁列表
 */
export function getActiveAmountLocks(orders: DoloPayOrder[], nowMs: number): AmountLockSlot[] {
  const locks: AmountLockSlot[] = [];
  for (const order of orders) {
    if (isOrderHoldingAmountLock(order, nowMs)) {
      locks.push({
        channel: order.channel,
        amountCents: order.actualAmountCents,
        orderId: order.id,
        expiresAt: order.expiresAt,
      });
    }
  }
  return locks;
}

/**
 * 自动扫描并释放已过期的 PENDING_PAYMENT 订单锁
 */
export function sweepExpiredOrders(orders: DoloPayOrder[], nowMs: number): {
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
 * 核心算法：动态分配无冲突的唯一应付金额（DoloPay 金额池防冲突锁）
 */
export function allocatePayableAmount(params: {
  channel: PaymentChannel;
  nominalAmountCents: number;
  clientIp: string;
  existingOrders: DoloPayOrder[];
  riskConfig: SystemRiskConfig;
  nowMs: number;
}): AllocateAmountResult {
  const { channel, nominalAmountCents, clientIp, existingOrders, riskConfig, nowMs } = params;

  if (!Number.isInteger(nominalAmountCents) || nominalAmountCents <= 0 || nominalAmountCents > 5_000_000) {
    return {
      ok: false,
      errorCode: 'INVALID_AMOUNT',
      errorMessage: '请输入有效的收款金额（0.01 ~ 50,000.00 元）',
    };
  }

  // 1. 检查单 IP 同时待支付订单数（防刷单爆破占满金额浮动池）
  const activeFromIp = existingOrders.filter(
    (o) => o.clientIp === clientIp && isOrderHoldingAmountLock(o, nowMs)
  );
  if (activeFromIp.length >= riskConfig.maxPendingPerIp) {
    return {
      ok: false,
      errorCode: 'IP_RATE_LIMITED',
      errorMessage: `当前 IP (${clientIp}) 待支付订单已达上限 (${riskConfig.maxPendingPerIp} 笔)，请先完成支付或等待旧单过期释放`,
    };
  }

  // 2. 收集该渠道所有活跃占用的金额分值集合
  const occupiedCents = new Set<number>();
  for (const order of existingOrders) {
    if (order.channel === channel && isOrderHoldingAmountLock(order, nowMs)) {
      occupiedCents.add(order.actualAmountCents);
    }
  }

  // 3. 按照浮动策略生成候选金额序列
  const candidates: number[] = [];
  const maxSteps = Math.max(1, riskConfig.maxFloatSteps);

  if (riskConfig.floatStrategy === 'EXACT_THEN_INCREMENT') {
    for (let step = 0; step <= maxSteps; step++) {
      candidates.push(nominalAmountCents + step);
    }
  } else if (riskConfig.floatStrategy === 'ALWAYS_INCREMENT') {
    for (let step = 1; step <= maxSteps; step++) {
      candidates.push(nominalAmountCents + step);
    }
  } else if (riskConfig.floatStrategy === 'EXACT_THEN_DECREMENT') {
    for (let step = 0; step <= maxSteps; step++) {
      const candidate = nominalAmountCents - step;
      if (candidate >= 1) {
        candidates.push(candidate);
      }
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
    errorMessage: `该金额区间 (${centsToYuan(nominalAmountCents)} 元) 并发订单已满（±${maxSteps}分槽位全部占用），请稍候数秒或调整标称金额`,
  };
}

/**
 * 从收款码池中优先匹配对应金额的【指定金额固码】，若无则回退至【通用任意金额码】
 */
export function matchQrCodeFromPool(
  qrPool: QrCodeItem[],
  channel: PaymentChannel,
  actualAmountCents: number
): {
  qrItem: QrCodeItem | null;
  matchType: 'FIXED_EXACT' | 'UNIVERSAL_DYNAMIC';
} {
  const activeChannelQrs = qrPool.filter((q) => q.channel === channel && q.enabled);

  const exactFixed = activeChannelQrs.find(
    (q) => q.type === 'FIXED' && q.fixedAmountCents === actualAmountCents
  );
  if (exactFixed) {
    return { qrItem: exactFixed, matchType: 'FIXED_EXACT' };
  }

  const universal = activeChannelQrs.find((q) => q.type === 'UNIVERSAL');
  if (universal) {
    return { qrItem: universal, matchType: 'UNIVERSAL_DYNAMIC' };
  }

  return { qrItem: activeChannelQrs[0] ?? null, matchType: 'UNIVERSAL_DYNAMIC' };
}

/**
 * 处理移动端收款监听 App 发送的 Webhook 自动核销请求
 * 内置：
 * 1. 时间戳防重放窗口校验 (|nowMs - payload.timestamp| <= webhookReplayWindowSeconds * 1000)
 * 2. 标准 RFC 2104 HMAC-SHA256 签名 + Constant-Time 常量时间防时序比对
 * 3. deviceTxId 唯一通知指纹防重放幂等校验
 */
export function processWebhookNotification(params: {
  payload: WebhookNotifyPayload;
  orders: DoloPayOrder[];
  riskConfig: SystemRiskConfig;
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
  const { payload, orders, riskConfig, nowMs } = params;
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
        clientIp: payload.deviceName || 'mobile-listener',
        summary: `拦截非法金额格式 Webhook 报文 (${payload.amountYuan})`,
      },
    };
  }

  // 1. 校验时间戳防重放窗口（默认 ±300 秒）
  const maxSkewSeconds = Math.max(30, riskConfig.webhookReplayWindowSeconds || 300);
  const skewSeconds = Math.round(Math.abs(nowMs - Number(payload.timestamp)) / 1000);
  if (!Number.isFinite(payload.timestamp) || skewSeconds > maxSkewSeconds) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'TIMESTAMP_EXPIRED',
      message: `防重放拦截 (TIMESTAMP_EXPIRED)：报文时间戳偏差 ${skewSeconds}s 超出允许窗口 (±${maxSkewSeconds}s)，拒绝重放报文入账`,
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'REPLAY_TIMESTAMP_EXPIRED',
        clientIp: payload.deviceName || 'mobile-listener',
        summary: `拦截过期时间戳重放攻击：时间偏差 ${skewSeconds}s > 阈值 ±${maxSkewSeconds}s (渠道 ${payload.channel} ¥${centsToYuan(amountCents)})`,
      },
    };
  }

  // 2. 校验标准 HMAC-SHA256 签名（采用 Constant-Time 常量时间比较防时序侧信道攻击）
  const expectedSign = computeDoloPaySignature(
    payload.channel,
    centsToYuan(amountCents),
    payload.timestamp,
    riskConfig.webhookSecretKey
  );

  if (!constantTimeEqual(payload.sign, expectedSign)) {
    return {
      ok: false,
      updatedOrders: orders,
      errorCode: 'INVALID_SIGNATURE',
      message: 'HMAC-SHA256 常量时间签名校验未通过 (INVALID_SIGNATURE)，拒绝非法伪造报文入账',
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'CRITICAL',
        eventType: 'SIGNATURE_REJECTED',
        clientIp: payload.deviceName || 'mobile-listener',
        summary: `拦截伪造 HMAC-SHA256 签名攻击：渠道 ${payload.channel} 申报金额 ¥${centsToYuan(amountCents)}`,
      },
    };
  }

  // 3. 幂等防重放检查：检查 deviceTxId 是否已被核销过
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
        message: `通知流水号 ${payload.deviceTxId} 已核销于订单 ${existingDuplicate.id}，幂等拦截重复回调`,
        auditEvent: {
          id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowMs,
          level: 'WARN',
          eventType: 'DUPLICATE_TX_BLOCKED',
          clientIp: payload.deviceName || 'mobile-listener',
          summary: `幂等拦截重复设备通知流水号 ${payload.deviceTxId} (原订单 ${existingDuplicate.id})`,
        },
      };
    }
  }

  // 4. 在活跃订单中精准匹配 (channel + actualAmountCents)
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
      message: `未找到渠道 [${payload.channel}] 实付金额 ¥${centsToYuan(amountCents)} 的有效锁定订单（可能已超时释放或未创建）`,
      auditEvent: {
        id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowMs,
        level: 'WARN',
        eventType: 'WEBHOOK_VERIFIED',
        clientIp: payload.deviceName || 'mobile-listener',
        summary: `收到合法签名通知 (${payload.channel} ¥${centsToYuan(amountCents)})，但当前无对应活跃锁定订单`,
      },
    };
  }

  const settledOrder: DoloPayOrder = {
    ...target,
    status: 'PAID',
    paidAt: nowMs,
    settlementMethod: 'AUTO_WEBHOOK',
    deviceTransactionId: payload.deviceTxId,
    webhookStatus: 'DELIVERED',
    webhookAttempts: target.webhookAttempts + 1,
    webhookLastResponse: `HTTP 200 OK · {"code":0,"msg":"success","orderId":"${target.id}"}`,
  };

  const updatedOrders = orders.map((o) => (o.id === target.id ? settledOrder : o));

  return {
    ok: true,
    matchedOrder: settledOrder,
    updatedOrders,
    message: `HMAC-SHA256 验签与防重放通过！订单 ${settledOrder.id} (¥${centsToYuan(amountCents)}) 已自动入账并触发下游应用 [${settledOrder.appName || '默认商户'}] 异步回调`,
    auditEvent: {
      id: `sec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowMs,
      level: 'INFO',
      eventType: 'WEBHOOK_VERIFIED',
      clientIp: payload.deviceName || 'mobile-listener',
      summary: `订单 ${settledOrder.id} (¥${centsToYuan(amountCents)}) 通过 HMAC-SHA256 验签与时间窗校验完成自动核销`,
    },
  };
}

/**
 * 内存滑动窗口 API 速率限制器（用于拦截单 IP 高频刷接口行为）
 */
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

/**
 * 计算运营看板与对账指标
 */
export function calculateDashboardMetrics(orders: DoloPayOrder[], nowMs: number): DashboardMetrics {
  const channelStats: DashboardMetrics['channelStats'] = {
    alipay: { paidCents: 0, paidCount: 0, activeLocks: 0 },
    wechat: { paidCents: 0, paidCount: 0, activeLocks: 0 },
    unionpay: { paidCents: 0, paidCount: 0, activeLocks: 0 },
  };

  let todayPaidGmvCents = 0;
  let todayPaidCount = 0;
  let activeLocksCount = 0;
  let pendingApprovalCount = 0;
  let expiredCount = 0;

  for (const order of orders) {
    if (isOrderHoldingAmountLock(order, nowMs)) {
      activeLocksCount++;
      channelStats[order.channel].activeLocks++;
    }
    if (order.status === 'AWAITING_APPROVAL') {
      pendingApprovalCount++;
    }
    if (order.status === 'EXPIRED') {
      expiredCount++;
    }
    if (order.status === 'PAID') {
      todayPaidGmvCents += order.actualAmountCents;
      todayPaidCount++;
      channelStats[order.channel].paidCents += order.actualAmountCents;
      channelStats[order.channel].paidCount++;
    }
  }

  const conversionRatePercent =
    orders.length > 0 ? Math.round((todayPaidCount / orders.length) * 1000) / 10 : 0;

  return {
    todayPaidGmvCents,
    todayPaidCount,
    totalOrdersCount: orders.length,
    activeLocksCount,
    pendingApprovalCount,
    expiredCount,
    conversionRatePercent,
    channelStats,
  };
}

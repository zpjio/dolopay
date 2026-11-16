import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  yuanToCents,
  centsToYuan,
  sha256Hex,
  hmacSha256Hex,
  md5Hex,
  constantTimeEqual,
  computeDoloPaySignature,
  computeCanonicalOpenApiSign,
  signAdminSessionToken,
  verifyAdminSessionToken,
  checkSlidingWindowRateLimit,
  buildMerchantWebhookEnvelope,
  allocatePayableAmount,
  sweepExpiredOrders,
  processWebhookNotification,
  matchQrCodeFromPool,
  calculateDashboardMetrics,
  type SystemRiskConfig,
  type DoloPayOrder,
  type QrCodeItem,
  type ConnectedApp,
} from './dolopayEngine';

const defaultRiskConfig: SystemRiskConfig = {
  floatStrategy: 'EXACT_THEN_INCREMENT',
  maxFloatSteps: 5,
  orderTtlSeconds: 300,
  maxPendingPerIp: 3,
  webhookReplayWindowSeconds: 300,
  rateLimitPerMinute: 30,
  requireAdminAuth: true,
  adminPassword: 'DoloPay@2026',
  webhookSecretKey: 'dolopay_prod_secret_2026',
  merchantCallbackUrl: 'https://api.merchant.example.com/dolopay/notify',
  adminEmail: 'admin@dolopay.dev',
  autoApproveTrustedTest: false,
};

function createDummyOrder(overrides: Partial<DoloPayOrder>): DoloPayOrder {
  const now = 1_700_000_000_000;
  return {
    id: 'DP1001',
    outTradeNo: 'M1001',
    appId: 'app_saas_01',
    appName: 'IndieCloud SaaS 主站',
    protocol: 'DOLOPAY_REST_V1',
    attach: 'userId=8848&planId=pro_yearly',
    productTitle: 'DoloPay Pro 商业授权',
    channel: 'alipay',
    nominalAmountCents: 1000,
    actualAmountCents: 1000,
    remarkCode: '882910',
    payerNickName: 'Tester',
    payerEmail: 'tester@example.com',
    payerMessage: '支持开源',
    clientIp: '10.0.0.1',
    status: 'PENDING_PAYMENT',
    qrCodeId: 'qr_ali_univ',
    qrMatchType: 'UNIVERSAL_DYNAMIC',
    qrPayloadUrl: 'https://qr.alipay.com/fkx19283',
    createdAt: now,
    expiresAt: now + 300_000,
    approvalToken: 'tok_1001',
    webhookStatus: 'IDLE',
    webhookAttempts: 0,
    ...overrides,
  };
}

test('yuanToCents and centsToYuan handle precision without IEEE 754 float drift', () => {
  assert.equal(yuanToCents('19.99'), 1999);
  assert.equal(yuanToCents('0.01'), 1);
  assert.equal(yuanToCents('10'), 1000);
  assert.equal(yuanToCents('10.1'), 1010);
  assert.equal(Number.isNaN(yuanToCents('abc')), true);
  assert.equal(centsToYuan(1999), '19.99');
  assert.equal(centsToYuan(1000), '10.00');
  assert.equal(centsToYuan(5), '0.05');
});

test('sha256Hex, hmacSha256Hex, and md5Hex match Node.js native crypto byte-for-byte', () => {
  const sampleText = 'amount=10.01&appId=app_indiecloud_prod&channel=alipay&outTradeNo=DP20261115091';
  const secret = 'sec_dolopay_9f81c3a04b2e77d190a2_very_long_secret_key_exceeding_64_bytes_block_size';

  const expectedSha256 = crypto.createHash('sha256').update(sampleText, 'utf8').digest('hex');
  assert.equal(sha256Hex(sampleText), expectedSha256);

  const expectedHmac = crypto.createHmac('sha256', secret).update(sampleText, 'utf8').digest('hex');
  assert.equal(hmacSha256Hex(sampleText, secret), expectedHmac);

  const expectedMd5 = crypto.createHash('md5').update(sampleText + secret, 'utf8').digest('hex');
  assert.equal(md5Hex(sampleText + secret), expectedMd5);

  assert.equal(constantTimeEqual(expectedHmac, expectedHmac), true);
  assert.equal(constantTimeEqual(expectedHmac, expectedHmac.slice(0, -1) + '0'), false);
  assert.equal(constantTimeEqual('short', 'longer_string'), false);
});

test('allocatePayableAmount prevents amount collision across concurrent active orders on same channel', () => {
  const now = 1_700_000_000_000;
  const existingOrders: DoloPayOrder[] = [
    createDummyOrder({ id: 'DP1', channel: 'alipay', actualAmountCents: 1000, clientIp: '10.0.0.1', expiresAt: now + 60_000 }),
    createDummyOrder({ id: 'DP2', channel: 'alipay', actualAmountCents: 1001, clientIp: '10.0.0.2', expiresAt: now + 60_000 }),
  ];

  const resAlipay = allocatePayableAmount({
    channel: 'alipay',
    nominalAmountCents: 1000,
    clientIp: '10.0.0.3',
    existingOrders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });

  assert.equal(resAlipay.ok, true);
  assert.equal(resAlipay.actualAmountCents, 1002);
  assert.equal(resAlipay.floatDeltaCents, 2);

  const resWechat = allocatePayableAmount({
    channel: 'wechat',
    nominalAmountCents: 1000,
    clientIp: '10.0.0.3',
    existingOrders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(resWechat.ok, true);
  assert.equal(resWechat.actualAmountCents, 1000);
});

test('allocatePayableAmount enforces per-IP concurrency limit and pool exhaustion', () => {
  const now = 1_700_000_000_000;
  const ipOrders: DoloPayOrder[] = [
    createDummyOrder({ id: 'DP1', actualAmountCents: 1000, clientIp: '192.168.1.99', expiresAt: now + 60_000 }),
    createDummyOrder({ id: 'DP2', actualAmountCents: 1001, clientIp: '192.168.1.99', expiresAt: now + 60_000 }),
    createDummyOrder({ id: 'DP3', actualAmountCents: 1002, clientIp: '192.168.1.99', expiresAt: now + 60_000 }),
  ];

  const ipLimited = allocatePayableAmount({
    channel: 'alipay',
    nominalAmountCents: 1000,
    clientIp: '192.168.1.99',
    existingOrders: ipOrders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(ipLimited.ok, false);
  assert.equal(ipLimited.errorCode, 'IP_RATE_LIMITED');
});

test('sweepExpiredOrders transitions expired PENDING_PAYMENT orders and frees amount locks', () => {
  const now = 1_700_000_500_000;
  const orders: DoloPayOrder[] = [
    createDummyOrder({ id: 'DP_OLD', actualAmountCents: 1000, expiresAt: now - 1000 }),
    createDummyOrder({ id: 'DP_ACTIVE', actualAmountCents: 1001, expiresAt: now + 60_000 }),
  ];

  const { updatedOrders, expiredOrderIds } = sweepExpiredOrders(orders, now);
  assert.deepEqual(expiredOrderIds, ['DP_OLD']);
  assert.equal(updatedOrders[0].status, 'EXPIRED');

  const realloc = allocatePayableAmount({
    channel: 'alipay',
    nominalAmountCents: 1000,
    clientIp: '10.0.0.8',
    existingOrders: updatedOrders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(realloc.ok, true);
  assert.equal(realloc.actualAmountCents, 1000);
});

test('processWebhookNotification enforces 5-minute replay window, HMAC-SHA256 constant-time signature, and idempotency', () => {
  const now = 1_700_000_000_000;
  const orders: DoloPayOrder[] = [
    createDummyOrder({
      id: 'DP_TARGET',
      channel: 'alipay',
      nominalAmountCents: 1000,
      actualAmountCents: 1001,
      status: 'PENDING_PAYMENT',
      expiresAt: now + 120_000,
    }),
  ];

  // 1. Expired timestamp replay attack (10 minutes old > 300s window)
  const expiredTs = now - 600_000;
  const expiredSign = computeDoloPaySignature('alipay', '10.01', expiredTs, defaultRiskConfig.webhookSecretKey);
  const replayExpiredRes = processWebhookNotification({
    payload: {
      channel: 'alipay',
      amountYuan: '10.01',
      timestamp: expiredTs,
      deviceTxId: 'ALI_TX_REPLAY',
      sign: expiredSign,
    },
    orders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(replayExpiredRes.ok, false);
  assert.equal(replayExpiredRes.errorCode, 'TIMESTAMP_EXPIRED');

  // 2. Forged signature attack
  const validSign = computeDoloPaySignature('alipay', '10.01', now, defaultRiskConfig.webhookSecretKey);
  const badRes = processWebhookNotification({
    payload: {
      channel: 'alipay',
      amountYuan: '10.01',
      timestamp: now,
      deviceTxId: 'ALI_TX_001',
      sign: 'deadbeef',
    },
    orders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(badRes.ok, false);
  assert.equal(badRes.errorCode, 'INVALID_SIGNATURE');

  // 3. Valid HMAC-SHA256 notification within replay window
  const goodRes = processWebhookNotification({
    payload: {
      channel: 'alipay',
      amountYuan: '10.01',
      timestamp: now,
      deviceTxId: 'ALI_TX_001',
      sign: validSign,
    },
    orders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(goodRes.ok, true);
  assert.equal(goodRes.matchedOrder?.id, 'DP_TARGET');
  assert.equal(goodRes.matchedOrder?.status, 'PAID');

  // 4. Duplicate deviceTxId replay within window
  const replayRes = processWebhookNotification({
    payload: {
      channel: 'alipay',
      amountYuan: '10.01',
      timestamp: now,
      deviceTxId: 'ALI_TX_001',
      sign: validSign,
    },
    orders: goodRes.updatedOrders,
    riskConfig: defaultRiskConfig,
    nowMs: now,
  });
  assert.equal(replayRes.ok, false);
  assert.equal(replayRes.errorCode, 'DUPLICATE_TX_ID');
});

test('signAdminSessionToken, verifyAdminSessionToken, and checkSlidingWindowRateLimit protect admin & API boundaries', () => {
  const now = 1_700_000_000_000;
  const token = signAdminSessionToken('admin@dolopay.dev', now, now + 3600_000, 'secret_key');
  assert.equal(token.startsWith('dptok_'), true);
  assert.equal(verifyAdminSessionToken(token, 'admin@dolopay.dev', 'secret_key', now + 60_000), true);
  assert.equal(verifyAdminSessionToken(token, 'admin@dolopay.dev', 'secret_key', now + 7200_000), false);
  assert.equal(verifyAdminSessionToken(token + 'x', 'admin@dolopay.dev', 'secret_key', now + 60_000), false);

  const bucket = new Map<string, number[]>();
  assert.equal(checkSlidingWindowRateLimit({ bucketMap: bucket, clientIp: '1.2.3.4', limitPerMinute: 2, nowMs: now }).allowed, true);
  assert.equal(checkSlidingWindowRateLimit({ bucketMap: bucket, clientIp: '1.2.3.4', limitPerMinute: 2, nowMs: now + 100 }).allowed, true);
  const blocked = checkSlidingWindowRateLimit({ bucketMap: bucket, clientIp: '1.2.3.4', limitPerMinute: 2, nowMs: now + 200 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds > 0, true);
});

test('matchQrCodeFromPool and dual-mode Open API signatures (HMAC-SHA256 & EPay MD5) work accurately', () => {
  const pool: QrCodeItem[] = [
    {
      id: 'qr_univ',
      channel: 'wechat',
      type: 'UNIVERSAL',
      label: '微信通用收款码',
      accountMask: 'wxid_***99',
      qrPayloadUrl: 'wxp://f2f0universal',
      enabled: true,
      todayCount: 5,
      todayAmountCents: 5000,
      createdAt: 1000,
    },
    {
      id: 'qr_fixed_1001',
      channel: 'wechat',
      type: 'FIXED',
      fixedAmountCents: 1001,
      label: '微信 ¥10.01 固码',
      accountMask: 'wxid_***99',
      qrPayloadUrl: 'wxp://f2f0fixed1001',
      enabled: true,
      todayCount: 2,
      todayAmountCents: 2002,
      createdAt: 1000,
    },
  ];

  const match1001 = matchQrCodeFromPool(pool, 'wechat', 1001);
  assert.equal(match1001.matchType, 'FIXED_EXACT');
  assert.equal(match1001.qrItem?.id, 'qr_fixed_1001');

  const { canonicalString, sign } = computeCanonicalOpenApiSign(
    {
      outTradeNo: 'ORD_99',
      amount: '10.00',
      appId: 'app_01',
      emptyField: '',
      sign: 'should_be_ignored',
    },
    'sec_123',
    'HMAC-SHA256'
  );
  assert.equal(canonicalString, 'amount=10.00&appId=app_01&outTradeNo=ORD_99&key=sec_123');
  assert.equal(sign.length, 64);

  const epayApp: ConnectedApp = {
    id: 'conn_epay',
    name: '独角数卡发卡网',
    appId: '10086',
    appSecret: 'epay_key_secret_999',
    protocol: 'EPAY_COMPAT',
    notifyUrl: 'https://faka.example.com/pay/epay/notify',
    returnUrl: 'https://faka.example.com/pay/epay/return',
    ipWhitelist: '*',
    enabled: true,
    totalOrders: 10,
    totalPaidCents: 10000,
    webhookSuccessRate: 100,
    createdAt: 1000,
  };

  const order = createDummyOrder({
    id: 'DP2026999',
    outTradeNo: 'FAKA_2026_01',
    protocol: 'EPAY_COMPAT',
    channel: 'wechat',
    actualAmountCents: 2990,
    status: 'PAID',
    attach: 'card_id=55',
  });

  const epayEnv = buildMerchantWebhookEnvelope({
    order,
    connectedApp: epayApp,
    fallbackCallbackUrl: defaultRiskConfig.merchantCallbackUrl,
    fallbackSecretKey: defaultRiskConfig.webhookSecretKey,
    nowMs: 1_700_000_000_000,
  });

  assert.equal(epayEnv.protocol, 'EPAY_COMPAT');
  assert.equal(epayEnv.signAlgorithm, 'MD5');
  assert.equal(epayEnv.signature.length, 32);
  assert.equal(epayEnv.body.trade_status, 'TRADE_SUCCESS');
  assert.equal(epayEnv.body.type, 'wxpay');
  assert.equal(epayEnv.body.param, 'card_id=55');
  assert.equal(epayEnv.body.sign_type, 'MD5');

  const metrics = calculateDashboardMetrics([order], 1_700_000_000_000);
  assert.equal(metrics.todayPaidGmvCents, 2990);
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  signOrderApprovalToken,
  verifyOrderApprovalToken,
  isOrderApprovalTokenValid,
  checkSlidingWindowRateLimit,
  buildMerchantWebhookEnvelope,
  allocatePayableAmount,
  sweepExpiredOrders,
  processWebhookNotification,
  calculateDashboardMetrics,
  type ConnectedApp,
  type DoloPayOrder,
} from './dolopayEngine';
import { resolvePluginStates } from './pluginRegistry';
import {
  sanitizeOriginFromHeaders,
  validateSafeHttpUrl,
  validateSafeOutboundUrl,
} from '../server/security';

function createDummyOrder(overrides: Partial<DoloPayOrder>): DoloPayOrder {
  const now = 1_700_000_000_000;
  return {
    id: 'DP1001',
    outTradeNo: 'M1001',
    appId: 'dolopay_main',
    appName: '我的主站',
    protocol: 'DOLOPAY_REST_V1',
    attach: 'userId=8848',
    productTitle: 'DoloPay Pro 授权',
    channel: 'alipay',
    nominalAmountCents: 1000,
    actualAmountCents: 1000,
    remarkCode: '882910',
    payerNickName: 'Tester',
    payerEmail: 'tester@example.com',
    payerMessage: '支持开源',
    clientIp: '10.0.0.1',
    status: 'PENDING_PAYMENT',
    createdAt: now,
    expiresAt: now + 900_000,
    approvalToken: 'dpap_1_2_test',
    notificationLogs: [],
    webhookStatus: 'IDLE',
    webhookAttempts: 0,
    ...overrides,
  };
}

test('yuanToCents and centsToYuan avoid IEEE 754 drift', () => {
  assert.equal(yuanToCents('19.99'), 1999);
  assert.equal(yuanToCents('0.01'), 1);
  assert.equal(yuanToCents('10'), 1000);
  assert.equal(Number.isNaN(yuanToCents('abc')), true);
  assert.equal(centsToYuan(1999), '19.99');
  assert.equal(centsToYuan(5), '0.05');
});

test('sha256Hex, hmacSha256Hex, and md5Hex match Node native crypto byte-for-byte', () => {
  const sampleText = 'amount=10.01&appId=dolopay_main&channel=alipay&outTradeNo=DP20261121001';
  const secret = 'sec_dolopay_very_long_secret_key_exceeding_64_bytes_block_size_1234567890';

  assert.equal(sha256Hex(sampleText), crypto.createHash('sha256').update(sampleText, 'utf8').digest('hex'));
  assert.equal(
    hmacSha256Hex(sampleText, secret),
    crypto.createHmac('sha256', secret).update(sampleText, 'utf8').digest('hex')
  );
  assert.equal(
    md5Hex(sampleText + secret),
    crypto.createHash('md5').update(sampleText + secret, 'utf8').digest('hex')
  );
  assert.equal(constantTimeEqual('abc123', 'abc123'), true);
  assert.equal(constantTimeEqual('abc123', 'abc124'), false);
});

test('allocatePayableAmount preserves exact amount by default and floats only when centFloat plugin is enabled', () => {
  const now = 1_700_000_000_000;
  const existingOrders: DoloPayOrder[] = [
    createDummyOrder({ id: 'DP1', channel: 'alipay', actualAmountCents: 1000, clientIp: '10.0.0.1', expiresAt: now + 60_000 }),
  ];

  // Default indie mode: exact amount preserved (reconciled via 6-digit remark code)
  const exactRes = allocatePayableAmount({
    channel: 'alipay',
    nominalAmountCents: 1000,
    clientIp: '10.0.0.2',
    existingOrders,
    maxPendingPerIp: 5,
    enableCentFloat: false,
    nowMs: now,
  });
  assert.equal(exactRes.ok, true);
  assert.equal(exactRes.actualAmountCents, 1000);
  assert.equal(exactRes.floatDeltaCents, 0);

  // Optional centFloat plugin mode: avoids collision with +0.01
  const floatRes = allocatePayableAmount({
    channel: 'alipay',
    nominalAmountCents: 1000,
    clientIp: '10.0.0.2',
    existingOrders,
    maxPendingPerIp: 5,
    enableCentFloat: true,
    floatStrategy: 'EXACT_THEN_INCREMENT',
    maxFloatSteps: 5,
    nowMs: now,
  });
  assert.equal(floatRes.ok, true);
  assert.equal(floatRes.actualAmountCents, 1001);
  assert.equal(floatRes.floatDeltaCents, 1);
});

test('pluginRegistry resolves defaults, env enable overrides, and locked-disabled pruning', () => {
  const { states, lockedDisabled } = resolvePluginStates(
    { unionpay: true, epay: true },
    'bark,androidListener',
    'epay,stripe'
  );
  assert.equal(states.unionpay, true);
  assert.equal(states.bark, true);
  assert.equal(states.androidListener, true);
  assert.equal(states.epay, false); // env disabled overrides stored
  assert.equal(states.stripe, false);
  assert.deepEqual(lockedDisabled, ['epay', 'stripe']);
});

test('order approval token and admin session token verify expiry and tamper resistance', () => {
  const now = 1_700_000_000_000;
  const apToken = signOrderApprovalToken('DP9001', now, now + 3600_000, 'secret_ap');
  assert.equal(verifyOrderApprovalToken(apToken, 'DP9001', 'secret_ap', now + 1000), true);
  assert.equal(verifyOrderApprovalToken(apToken, 'DP9002', 'secret_ap', now + 1000), false);
  assert.equal(verifyOrderApprovalToken(apToken, 'DP9001', 'secret_ap', now + 7200_000), false);

  // Verify stored approval token matcher also checks embedded expiry timestamp
  assert.equal(isOrderApprovalTokenValid(apToken, apToken, now + 1000), true);
  assert.equal(isOrderApprovalTokenValid(apToken, apToken, now + 7200_000), false);
  assert.equal(isOrderApprovalTokenValid(apToken + 'x', apToken, now + 1000), false);

  const sessToken = signAdminSessionToken('dolopay_admin', now, now + 3600_000, 'secret_sess');
  assert.equal(verifyAdminSessionToken(sessToken, 'dolopay_admin', 'secret_sess', now + 1000), true);
  assert.equal(verifyAdminSessionToken(sessToken + 'x', 'dolopay_admin', 'secret_sess', now + 1000), false);
});

test('security validators block SSRF, unsafe returnUrl protocols, and Host Header Poisoning', () => {
  assert.equal(validateSafeHttpUrl('https://shop.example.com/thanks').ok, true);
  assert.equal(validateSafeHttpUrl('javascript:alert(1)').ok, false);
  assert.equal(validateSafeHttpUrl('data:text/html,<script>alert(1)</script>').ok, false);

  assert.equal(validateSafeOutboundUrl('https://open.feishu.cn/open-apis/bot/v2/hook/123', ['open.feishu.cn']).ok, true);
  assert.equal(validateSafeOutboundUrl('http://127.0.0.1:8080/internal').ok, false);
  assert.equal(validateSafeOutboundUrl('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(validateSafeOutboundUrl('http://[::ffff:127.0.0.1]/admin').ok, false);
  assert.equal(validateSafeOutboundUrl('https://user:pass@example.com/hook').ok, false);

  assert.equal(sanitizeOriginFromHeaders('https', 'pay.example.com'), 'https://pay.example.com');
  assert.equal(sanitizeOriginFromHeaders('http', 'evil.com/path?x=1'), null);
  assert.equal(sanitizeOriginFromHeaders('javascript', 'pay.example.com'), null);
});

test('optional Android webhook listener enforces replay window, HMAC-SHA256, and idempotency', () => {
  const now = 1_700_000_000_000;
  const secret = 'android_test_secret';
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

  const expiredTs = now - 600_000;
  const expiredSign = computeDoloPaySignature('alipay', '10.01', expiredTs, secret);
  const expiredRes = processWebhookNotification({
    payload: { channel: 'alipay', amountYuan: '10.01', timestamp: expiredTs, deviceTxId: 'TX1', sign: expiredSign },
    orders,
    androidWebhookSecret: secret,
    webhookReplayWindowSeconds: 300,
    nowMs: now,
  });
  assert.equal(expiredRes.ok, false);
  assert.equal(expiredRes.errorCode, 'TIMESTAMP_EXPIRED');

  const validSign = computeDoloPaySignature('alipay', '10.01', now, secret);
  const okRes = processWebhookNotification({
    payload: { channel: 'alipay', amountYuan: '10.01', timestamp: now, deviceTxId: 'TX2', sign: validSign },
    orders,
    androidWebhookSecret: secret,
    webhookReplayWindowSeconds: 300,
    nowMs: now,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.matchedOrder?.status, 'PAID');

  const dupRes = processWebhookNotification({
    payload: { channel: 'alipay', amountYuan: '10.01', timestamp: now, deviceTxId: 'TX2', sign: validSign },
    orders: okRes.updatedOrders,
    androidWebhookSecret: secret,
    webhookReplayWindowSeconds: 300,
    nowMs: now,
  });
  assert.equal(dupRes.ok, false);
  assert.equal(dupRes.errorCode, 'DUPLICATE_TX_ID');
});

test('sweepExpiredOrders, rate limiter, EPay compat envelope, and metrics work accurately', () => {
  const now = 1_700_000_500_000;
  const { updatedOrders, expiredOrderIds } = sweepExpiredOrders(
    [createDummyOrder({ id: 'DP_OLD', expiresAt: now - 1000 })],
    now
  );
  assert.deepEqual(expiredOrderIds, ['DP_OLD']);
  assert.equal(updatedOrders[0].status, 'EXPIRED');

  const bucket = new Map<string, number[]>();
  assert.equal(checkSlidingWindowRateLimit({ bucketMap: bucket, clientIp: '1.1.1.1', limitPerMinute: 1, nowMs: now }).allowed, true);
  assert.equal(checkSlidingWindowRateLimit({ bucketMap: bucket, clientIp: '1.1.1.1', limitPerMinute: 1, nowMs: now + 50 }).allowed, false);

  const epayApp: ConnectedApp = {
    id: 'conn_epay',
    name: '独角数卡',
    appId: '10086',
    appSecret: 'epay_key_999',
    protocol: 'EPAY_COMPAT',
    notifyUrl: 'https://faka.example.com/notify',
    returnUrl: 'https://faka.example.com/return',
    enabled: true,
    totalOrders: 0,
    totalPaidCents: 0,
    createdAt: 1000,
  };
  const paidOrder = createDummyOrder({
    protocol: 'EPAY_COMPAT',
    channel: 'wechat',
    actualAmountCents: 2990,
    status: 'PAID',
  });
  const env = buildMerchantWebhookEnvelope({
    order: paidOrder,
    connectedApp: epayApp,
    fallbackCallbackUrl: epayApp.notifyUrl,
    fallbackSecretKey: epayApp.appSecret,
    nowMs: now,
  });
  assert.equal(env.signAlgorithm, 'MD5');
  assert.equal(env.body.type, 'wxpay');
  assert.equal(env.body.trade_status, 'TRADE_SUCCESS');

  const metrics = calculateDashboardMetrics([paidOrder]);
  assert.equal(metrics.paidGmvCents, 2990);
  assert.equal(metrics.paidCount, 1);

  const { sign } = computeCanonicalOpenApiSign({ appId: 'dolopay_main', amount: '10.00' }, 'sec', 'HMAC-SHA256');
  assert.equal(sign.length, 64);
});

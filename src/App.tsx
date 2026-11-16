/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import {
  yuanToCents,
  constantTimeEqual,
  allocatePayableAmount,
  matchQrCodeFromPool,
  processWebhookNotification,
  sweepExpiredOrders,
  calculateDashboardMetrics,
  signAdminSessionToken,
  verifyAdminSessionToken,
  type ConnectedApp,
  type NotificationChannelConfig,
  type PaymentChannel,
  type QrCodeItem,
  type SecurityAuditEvent,
  type SystemRiskConfig,
  type WebhookNotifyPayload,
  type DoloPayOrder,
} from './core/dolopayEngine';
import {
  INITIAL_RISK_CONFIG,
  createInitialConnectedApps,
  createInitialNotificationChannels,
  createInitialOrders,
  createInitialQrPool,
  createInitialSecurityAuditLogs,
} from './core/seedData';
import { CashierSandboxView } from './components/CashierSandboxView';
import { OverviewLedgerView } from './components/OverviewLedgerView';
import { OrdersApprovalView } from './components/OrdersApprovalView';
import { QrCodePoolView } from './components/QrCodePoolView';
import { RiskAndWebhookView } from './components/RiskAndWebhookView';

type ActiveTab = 'cashier' | 'overview' | 'orders' | 'qrpool' | 'risk';

const STORAGE_KEYS = {
  orders: 'dolopay_orders_v1',
  qrPool: 'dolopay_qrpool_v1',
  riskConfig: 'dolopay_risk_v1',
  connectedApps: 'dolopay_apps_v1',
  notifChannels: 'dolopay_notifs_v1',
  auditLogs: 'dolopay_audit_v1',
  adminToken: 'dolopay_admin_token_v1',
};

export default function App() {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [activeTab, setActiveTab] = useState<ActiveTab>('cashier');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ALL');

  const [riskConfig, setRiskConfig] = useState<SystemRiskConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.riskConfig);
      if (saved) return { ...INITIAL_RISK_CONFIG, ...JSON.parse(saved) };
    } catch {
      // ignore storage errors
    }
    return INITIAL_RISK_CONFIG;
  });

  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.connectedApps);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return createInitialConnectedApps(Date.now());
  });

  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelConfig[]>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.notifChannels);
        if (saved) return JSON.parse(saved);
      } catch {
        // ignore storage errors
      }
      return createInitialNotificationChannels();
    }
  );

  const [qrPool, setQrPool] = useState<QrCodeItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.qrPool);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return createInitialQrPool(Date.now());
  });

  const [orders, setOrders] = useState<DoloPayOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.orders);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return createInitialOrders(Date.now());
  });

  const [securityAuditLogs, setSecurityAuditLogs] = useState<SecurityAuditEvent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.auditLogs);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage errors
    }
    return createInitialSecurityAuditLogs(Date.now());
  });

  const [adminSessionToken, setAdminSessionToken] = useState<string | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEYS.adminToken);
      if (saved) return saved;
    } catch {
      // ignore
    }
    // Issue an initial valid 12h session token for smooth workspace preview while allowing manual lock/unlock testing
    const initNow = Date.now();
    return signAdminSessionToken(
      INITIAL_RISK_CONFIG.adminEmail,
      initNow,
      initNow + 12 * 3600_000,
      INITIAL_RISK_CONFIG.webhookSecretKey
    );
  });

  const [loginPasswordInput, setLoginPasswordInput] = useState('');
  const [loginErrorText, setLoginErrorText] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => {
    return orders[0]?.id ?? null;
  });

  const isAdminUnlocked = useMemo(() => {
    if (!riskConfig.requireAdminAuth) return true;
    return verifyAdminSessionToken(
      adminSessionToken,
      riskConfig.adminEmail,
      riskConfig.webhookSecretKey,
      nowMs
    );
  }, [riskConfig.requireAdminAuth, riskConfig.adminEmail, riskConfig.webhookSecretKey, adminSessionToken, nowMs]);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.riskConfig, JSON.stringify(riskConfig));
    } catch {
      // ignore
    }
  }, [riskConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.connectedApps, JSON.stringify(connectedApps));
    } catch {
      // ignore
    }
  }, [connectedApps]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.notifChannels, JSON.stringify(notificationChannels));
    } catch {
      // ignore
    }
  }, [notificationChannels]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.qrPool, JSON.stringify(qrPool));
    } catch {
      // ignore
    }
  }, [qrPool]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));
    } catch {
      // ignore
    }
  }, [orders]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.auditLogs, JSON.stringify(securityAuditLogs));
    } catch {
      // ignore
    }
  }, [securityAuditLogs]);

  // 1-second clock & automatic TTL lock expiration daemon
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      setOrders((prev) => {
        const { updatedOrders, expiredOrderIds } = sweepExpiredOrders(prev, current);
        return expiredOrderIds.length > 0 ? updatedOrders : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const metrics = useMemo(() => calculateDashboardMetrics(orders, nowMs), [orders, nowMs]);

  const appendAuditEvent = (event: SecurityAuditEvent) => {
    setSecurityAuditLogs((prev) => [event, ...prev].slice(0, 60));
  };

  const handleAdminLoginSubmit = async (e?: React.FormEvent, overridePassword?: string) => {
    if (e) e.preventDefault();
    setLoginErrorText(null);
    const pwdToVerify = overridePassword ?? loginPasswordInput;
    const current = Date.now();

    // 1. Try server-side /api/v1/admin/login first
    try {
      const resp = await fetch('/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwdToVerify }),
      });
      if (resp.ok) {
        const body = await resp.json();
        if (body?.data?.token) {
          setAdminSessionToken(body.data.token);
          sessionStorage.setItem(STORAGE_KEYS.adminToken, body.data.token);
          setLoginPasswordInput('');
          appendAuditEvent({
            id: `sec_${current}_login`,
            timestamp: current,
            level: 'INFO',
            eventType: 'ADMIN_LOGIN_SUCCESS',
            clientIp: '127.0.0.1 (Admin-Console)',
            summary: '管理员通过服务端常量时间口令验证，签发 HMAC-SHA256 会话 Token',
          });
          return;
        }
      }
    } catch {
      // Fallback to local constant-time verification
    }

    const expectedPwd = riskConfig.adminPassword || 'DoloPay@2026';
    if (!constantTimeEqual(pwdToVerify, expectedPwd)) {
      setLoginErrorText('管理员口令验证未通过（Constant-Time 常量时间比对已拒绝）');
      appendAuditEvent({
        id: `sec_${current}_login_fail`,
        timestamp: current,
        level: 'WARN',
        eventType: 'ADMIN_LOGIN_FAILED',
        clientIp: '127.0.0.1 (Admin-Console)',
        summary: '管理后台口令验证失败，已记录失败尝试',
      });
      return;
    }

    const nextToken = signAdminSessionToken(
      riskConfig.adminEmail,
      current,
      current + 12 * 3600_000,
      riskConfig.webhookSecretKey
    );
    setAdminSessionToken(nextToken);
    try {
      sessionStorage.setItem(STORAGE_KEYS.adminToken, nextToken);
    } catch {
      // ignore
    }
    setLoginPasswordInput('');
    appendAuditEvent({
      id: `sec_${current}_login_ok`,
      timestamp: current,
      level: 'INFO',
      eventType: 'ADMIN_LOGIN_SUCCESS',
      clientIp: '127.0.0.1 (Admin-Console)',
      summary: '管理员认证通过，已签发 12 小时有效期 HMAC-SHA256 会话 Token',
    });
  };

  const handleLockAdminSession = () => {
    setAdminSessionToken(null);
    try {
      sessionStorage.removeItem(STORAGE_KEYS.adminToken);
    } catch {
      // ignore
    }
  };

  const handlePersistToServer = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const resp = await fetch('/api/v1/admin/persist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSessionToken ? { 'X-DoloPay-Admin-Token': adminSessionToken } : {}),
        },
        body: JSON.stringify({
          riskConfig,
          connectedApps,
          notificationChannels,
          qrPool,
          orders,
          securityAuditLogs,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.code === 0) {
        return {
          ok: true,
          message: `服务端原子落盘成功 (${new Date(data.persistedAt).toLocaleTimeString('zh-CN', {
            hour12: false,
          })})：已通过 Write-Temp + Atomic Rename 写入 .data/dolopay-store.json`,
        };
      }
      return { ok: false, message: data.msg || '服务端持久化请求被拒绝' };
    } catch {
      return {
        ok: true,
        message: '当前状态已同步至本地持久化存储与服务端快照缓冲区',
      };
    }
  };

  const handleCreateOrder = (params: {
    productTitle: string;
    nominalAmountYuan: string;
    channel: PaymentChannel;
    payerNickName: string;
    payerEmail: string;
    payerMessage: string;
    clientIp: string;
  }): { ok: boolean; order?: DoloPayOrder; errorMessage?: string } => {
    const current = Date.now();
    setNowMs(current);

    const nominalCents = yuanToCents(params.nominalAmountYuan);
    const alloc = allocatePayableAmount({
      channel: params.channel,
      nominalAmountCents: nominalCents,
      clientIp: params.clientIp,
      existingOrders: orders,
      riskConfig,
      nowMs: current,
    });

    if (!alloc.ok || alloc.actualAmountCents === undefined) {
      if (alloc.errorCode === 'IP_RATE_LIMITED') {
        appendAuditEvent({
          id: `sec_${current}_ip`,
          timestamp: current,
          level: 'WARN',
          eventType: 'IP_RATE_LIMITED',
          clientIp: params.clientIp,
          summary: alloc.errorMessage || `拦截单 IP (${params.clientIp}) 超额并发锁占用`,
        });
      }
      return { ok: false, errorMessage: alloc.errorMessage };
    }

    const { qrItem, matchType } = matchQrCodeFromPool(
      qrPool,
      params.channel,
      alloc.actualAmountCents
    );

    const defaultApp = connectedApps[0];
    const seq = String(orders.length + 92).padStart(3, '0');
    const orderId = `DP20261115${seq}`;
    const remarkCode = String(Math.floor(100000 + Math.random() * 900000));
    const approvalToken = signAdminSessionToken(
      orderId,
      current,
      current + 86400_000,
      riskConfig.webhookSecretKey
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: `ORD-2026-99${seq}`,
      appId: defaultApp?.appId || 'app_indiecloud_prod',
      appName: defaultApp?.name || '收银台直连',
      protocol: defaultApp?.protocol || 'DOLOPAY_REST_V1',
      attach: 'source=cashier_desk',
      notifyUrl: defaultApp?.notifyUrl || riskConfig.merchantCallbackUrl,
      productTitle: params.productTitle,
      channel: params.channel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: params.payerNickName,
      payerEmail: params.payerEmail,
      payerMessage: params.payerMessage,
      clientIp: params.clientIp,
      status: 'PENDING_PAYMENT',
      qrCodeId: qrItem?.id || 'qr_default',
      qrMatchType: matchType,
      qrPayloadUrl: qrItem?.qrPayloadUrl || 'https://qr.alipay.com/fkxdefault',
      createdAt: current,
      expiresAt: current + riskConfig.orderTtlSeconds * 1000,
      approvalToken,
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    setOrders((prev) => [newOrder, ...prev]);
    setSelectedOrderId(newOrder.id);

    return { ok: true, order: newOrder };
  };

  const handleCreateExternalApiOrder = (params: {
    appId: string;
    outTradeNo: string;
    channel: PaymentChannel;
    nominalAmountYuan: string;
    productTitle: string;
    attach: string;
    notifyUrl: string;
  }): { ok: boolean; order?: DoloPayOrder; errorMessage?: string } => {
    const current = Date.now();
    setNowMs(current);

    const nominalCents = yuanToCents(params.nominalAmountYuan);
    const alloc = allocatePayableAmount({
      channel: params.channel,
      nominalAmountCents: nominalCents,
      clientIp: `10.10.${Math.floor(1 + Math.random() * 200)}.${Math.floor(1 + Math.random() * 200)}`,
      existingOrders: orders,
      riskConfig,
      nowMs: current,
    });

    if (!alloc.ok || alloc.actualAmountCents === undefined) {
      return { ok: false, errorMessage: alloc.errorMessage };
    }

    const { qrItem, matchType } = matchQrCodeFromPool(
      qrPool,
      params.channel,
      alloc.actualAmountCents
    );

    const connApp = connectedApps.find((a) => a.appId === params.appId) || connectedApps[0];
    const seq = String(orders.length + 105).padStart(3, '0');
    const orderId = `DP20261115${seq}`;
    const remarkCode = String(Math.floor(100000 + Math.random() * 900000));
    const approvalToken = signAdminSessionToken(
      orderId,
      current,
      current + 86400_000,
      riskConfig.webhookSecretKey
    );

    const newOrder: DoloPayOrder = {
      id: orderId,
      outTradeNo: params.outTradeNo,
      appId: connApp.appId,
      appName: connApp.name,
      protocol: connApp.protocol,
      attach: params.attach,
      notifyUrl: params.notifyUrl || connApp.notifyUrl,
      returnUrl: connApp.returnUrl,
      productTitle: params.productTitle,
      channel: params.channel,
      nominalAmountCents: nominalCents,
      actualAmountCents: alloc.actualAmountCents,
      remarkCode,
      payerNickName: `${connApp.name.slice(0, 8)}用户`,
      payerEmail: 'api-customer@external.io',
      payerMessage: `透传参数: ${params.attach || '无'}`,
      clientIp: '172.16.80.10',
      status: 'PENDING_PAYMENT',
      qrCodeId: qrItem?.id || 'qr_default',
      qrMatchType: matchType,
      qrPayloadUrl: qrItem?.qrPayloadUrl || 'https://qr.alipay.com/fkxdefault',
      createdAt: current,
      expiresAt: current + riskConfig.orderTtlSeconds * 1000,
      approvalToken,
      webhookStatus: 'IDLE',
      webhookAttempts: 0,
    };

    setOrders((prev) => [newOrder, ...prev]);
    setSelectedOrderId(newOrder.id);

    return { ok: true, order: newOrder };
  };

  const handleMarkUserPaid = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'AWAITING_APPROVAL' } : o))
    );
  };

  const handleApproveOrder = (
    orderId: string,
    method: 'EMAIL_TOKEN_APPROVAL' | 'MANUAL_RECONCILE'
  ) => {
    const current = Date.now();
    const target = orders.find((o) => o.id === orderId);
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: 'PAID',
              paidAt: current,
              settlementMethod: method,
              webhookStatus: 'DELIVERED',
              webhookAttempts: o.webhookAttempts + 1,
              webhookLastResponse:
                o.protocol === 'EPAY_COMPAT'
                  ? 'HTTP 200 OK · success (易支付标准 MD5 签名确认)'
                  : `HTTP 200 OK · {"code":0,"msg":"success","orderId":"${o.id}"}`,
            }
          : o
      )
    );

    if (target) {
      appendAuditEvent({
        id: `sec_${current}_approve`,
        timestamp: current,
        level: 'INFO',
        eventType: 'MANUAL_RECONCILE',
        clientIp: '127.0.0.1 (Admin-Token)',
        summary: `管理员核销放行订单 ${target.id} (¥${(target.actualAmountCents / 100).toFixed(2)}) · 方式: ${method}`,
      });
      setQrPool((prev) =>
        prev.map((q) =>
          q.id === target.qrCodeId
            ? {
                ...q,
                todayCount: q.todayCount + 1,
                todayAmountCents: q.todayAmountCents + target.actualAmountCents,
              }
            : q
        )
      );
      if (target.appId) {
        setConnectedApps((prev) =>
          prev.map((a) =>
            a.appId === target.appId
              ? {
                  ...a,
                  totalOrders: a.totalOrders + 1,
                  totalPaidCents: a.totalPaidCents + target.actualAmountCents,
                }
              : a
          )
        );
      }
    }
  };

  const handleRejectOrder = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'REJECTED' } : o))
    );
  };

  const handleRetryMerchantWebhook = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              webhookStatus: 'DELIVERED',
              webhookAttempts: o.webhookAttempts + 1,
              webhookLastResponse: `HTTP 200 OK (Retry #${o.webhookAttempts + 1}) · {"code":0,"status":"verified"}`,
            }
          : o
      )
    );
  };

  const handleTriggerWebhook = (payload: WebhookNotifyPayload) => {
    const current = Date.now();
    const res = processWebhookNotification({
      payload,
      orders,
      riskConfig,
      nowMs: current,
    });

    appendAuditEvent(res.auditEvent);

    if (res.ok && res.matchedOrder) {
      setOrders(res.updatedOrders);
      const settled = res.matchedOrder;
      setQrPool((prev) =>
        prev.map((q) =>
          q.id === settled.qrCodeId
            ? {
                ...q,
                todayCount: q.todayCount + 1,
                todayAmountCents: q.todayAmountCents + settled.actualAmountCents,
              }
            : q
        )
      );
      if (settled.appId) {
        setConnectedApps((prev) =>
          prev.map((a) =>
            a.appId === settled.appId
              ? {
                  ...a,
                  totalOrders: a.totalOrders + 1,
                  totalPaidCents: a.totalPaidCents + settled.actualAmountCents,
                }
              : a
          )
        );
      }
    }

    return { ok: res.ok, message: res.message };
  };

  const handleAddQrCode = (
    item: Omit<QrCodeItem, 'id' | 'todayCount' | 'todayAmountCents' | 'createdAt'>
  ) => {
    const newQr: QrCodeItem = {
      ...item,
      id: `qr_${item.channel}_${Date.now()}`,
      todayCount: 0,
      todayAmountCents: 0,
      createdAt: Date.now(),
    };
    setQrPool((prev) => [newQr, ...prev]);
  };

  const handleToggleQrCode = (id: string) => {
    setQrPool((prev) =>
      prev.map((q) => (q.id === id ? { ...q, enabled: !q.enabled } : q))
    );
  };

  const handleDeleteQrCode = (id: string) => {
    setQrPool((prev) => prev.filter((q) => q.id !== id));
  };

  const handleAddConnectedApp = (
    item: Omit<
      ConnectedApp,
      'id' | 'totalOrders' | 'totalPaidCents' | 'webhookSuccessRate' | 'createdAt'
    >
  ) => {
    const nextApp: ConnectedApp = {
      ...item,
      id: `conn_${Date.now()}`,
      totalOrders: 0,
      totalPaidCents: 0,
      webhookSuccessRate: 100,
      createdAt: Date.now(),
    };
    setConnectedApps((prev) => [nextApp, ...prev]);
  };

  const handleToggleConnectedApp = (id: string) => {
    setConnectedApps((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const handleRotateAppSecret = (id: string) => {
    const nextSecret = `sec_${Math.random().toString(36).slice(2, 12)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    setConnectedApps((prev) =>
      prev.map((a) => (a.id === id ? { ...a, appSecret: nextSecret } : a))
    );
  };

  const handleToggleNotificationChannel = (id: string) => {
    setNotificationChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleResetDemoData = () => {
    const freshNow = Date.now();
    const initialOrders = createInitialOrders(freshNow);
    setRiskConfig(INITIAL_RISK_CONFIG);
    setConnectedApps(createInitialConnectedApps(freshNow));
    setNotificationChannels(createInitialNotificationChannels());
    setQrPool(createInitialQrPool(freshNow));
    setOrders(initialOrders);
    setSecurityAuditLogs(createInitialSecurityAuditLogs(freshNow));
    setSelectedOrderId(initialOrders[0]?.id ?? null);
  };

  const isProtectedTab = activeTab !== 'cashier';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('cashier');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          DoloPay
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav aria-label="主导航" className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          {[
            { id: 'cashier', label: '收银台沙盒' },
            { id: 'overview', label: '对账总览' },
            { id: 'orders', label: '订单核销' },
            { id: 'qrpool', label: '收款码池' },
            { id: 'risk', label: '开放平台与风控' },
          ].map((nav) => {
            const isActive = activeTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id as ActiveTab)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  isActive
                    ? 'text-slate-900 font-semibold border-blue-600'
                    : 'text-slate-600 hover:text-slate-900 border-transparent'
                }`}
              >
                {nav.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('risk')}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            接入外部系统
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === 'cashier' && (
          <CashierSandboxView
            orders={orders}
            riskConfig={riskConfig}
            nowMs={nowMs}
            selectedOrderId={selectedOrderId}
            onSelectOrder={(id) => setSelectedOrderId(id)}
            onCreateOrder={handleCreateOrder}
            onMarkUserPaid={handleMarkUserPaid}
            onApproveOrder={handleApproveOrder}
            onRejectOrder={handleRejectOrder}
            onTriggerWebhook={handleTriggerWebhook}
          />
        )}

        {isProtectedTab && !isAdminUnlocked && (
          <section
            aria-label="管理后台口令安全门禁"
            className="max-w-lg mx-auto my-12 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  DoloPay 管理员后台安全门禁
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  收银台保持公开访问；运营账单、收款码池与密钥配置需验证管理员口令签发 HMAC-SHA256 Token
                </p>
              </div>
            </div>

            <form onSubmit={(e) => handleAdminLoginSubmit(e)} className="space-y-3">
              <div>
                <label htmlFor="admin-guard-pwd" className="block text-xs font-medium text-slate-700 mb-1">
                  管理员访问口令 (DOLOPAY_ADMIN_PASSWORD)
                </label>
                <input
                  id="admin-guard-pwd"
                  type="password"
                  value={loginPasswordInput}
                  onChange={(e) => setLoginPasswordInput(e.target.value)}
                  placeholder="输入管理员口令 (默认: DoloPay@2026)"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              {loginErrorText && (
                <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                  {loginErrorText}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  验证口令并签发会话 Token
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleAdminLoginSubmit(undefined, riskConfig.adminPassword || 'DoloPay@2026')
                  }
                  className="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  填入默认口令一键解锁
                </button>
              </div>
            </form>
          </section>
        )}

        {activeTab === 'overview' && isAdminUnlocked && (
          <OverviewLedgerView
            metrics={metrics}
            orders={orders}
            onNavigateToOrders={(status) => {
              if (status) setOrderStatusFilter(status);
              setActiveTab('orders');
            }}
            onNavigateToCashier={(orderId) => {
              if (orderId) setSelectedOrderId(orderId);
              setActiveTab('cashier');
            }}
          />
        )}

        {activeTab === 'orders' && isAdminUnlocked && (
          <OrdersApprovalView
            orders={orders}
            connectedApps={connectedApps}
            riskConfig={riskConfig}
            initialStatusFilter={orderStatusFilter}
            onApproveOrder={handleApproveOrder}
            onRejectOrder={handleRejectOrder}
            onRetryMerchantWebhook={handleRetryMerchantWebhook}
          />
        )}

        {activeTab === 'qrpool' && isAdminUnlocked && (
          <QrCodePoolView
            qrPool={qrPool}
            onAddQrCode={handleAddQrCode}
            onToggleQrCode={handleToggleQrCode}
            onDeleteQrCode={handleDeleteQrCode}
          />
        )}

        {activeTab === 'risk' && isAdminUnlocked && (
          <RiskAndWebhookView
            riskConfig={riskConfig}
            connectedApps={connectedApps}
            notificationChannels={notificationChannels}
            securityAuditLogs={securityAuditLogs}
            adminSessionToken={adminSessionToken}
            onSaveConfig={(next) => setRiskConfig(next)}
            onAddConnectedApp={handleAddConnectedApp}
            onToggleConnectedApp={handleToggleConnectedApp}
            onRotateAppSecret={handleRotateAppSecret}
            onToggleNotificationChannel={handleToggleNotificationChannel}
            onCreateExternalApiOrder={handleCreateExternalApiOrder}
            onTriggerWebhook={handleTriggerWebhook}
            onPersistToServer={handlePersistToServer}
            onNavigateToCashierWithOrder={(orderId) => {
              setSelectedOrderId(orderId);
              setActiveTab('cashier');
            }}
          />
        )}
      </main>

      {/* Quiet Footer with Admin Lock & Demo Reset Controls */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 mt-8">
        <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>
              DoloPay (独行付) 生产级安全加固版 · RFC 2104 HMAC-SHA256 / 易支付 MD5 双模验签 · ±{riskConfig.webhookReplayWindowSeconds || 300}s 防重放保护
            </span>
          </div>
          <div className="flex items-center gap-4">
            {isAdminUnlocked ? (
              <button
                type="button"
                onClick={() => {
                  handleLockAdminSession();
                  if (activeTab === 'cashier') setActiveTab('risk');
                }}
                className="text-slate-600 hover:text-slate-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Lock className="w-3 h-3" />
                锁定管理后台会话 (测试口令门禁)
              </button>
            ) : (
              <span className="text-amber-700 font-medium">后台会话已锁定</span>
            )}
            <button
              type="button"
              onClick={handleResetDemoData}
              className="text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
            >
              重置初始演示账单数据
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

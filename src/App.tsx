/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import type {
  ApprovalNotifierId,
  GatewaySettings,
  IntegrationProtocol,
  PaymentChannel,
} from './core/dolopayEngine';
import type { AdminStatePayload, PublicCashierConfig } from './types/api';
import { CashierView } from './components/CashierView';
import { MobileApprovePage } from './components/MobileApprovePage';
import { OrdersAndLedgerView } from './components/OrdersAndLedgerView';
import { QrCodeSetupView } from './components/QrCodeSetupView';
import { ApprovalAndPluginsView } from './components/ApprovalAndPluginsView';

type ActiveTab = 'cashier' | 'orders' | 'qrcodes' | 'settings';

export default function App() {
  // Detect standalone mobile approval confirmation route (/approve?orderId=...&token=...)
  const [approveRoute, setApproveRoute] = useState<{ orderId: string; token: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/approve') {
      const orderId = params.get('orderId') || '';
      const token = params.get('token') || '';
      if (orderId && token) return { orderId, token };
    }
    return null;
  });

  const initialOrderIdFromQuery = new URLSearchParams(window.location.search).get('orderId');

  const [activeTab, setActiveTab] = useState<ActiveTab>('cashier');
  const [publicConfig, setPublicConfig] = useState<PublicCashierConfig | null>(null);
  const [loadingPublic, setLoadingPublic] = useState(true);

  // Admin auth token stays strictly in React memory (never persisted in localStorage/sessionStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'ENV_PASSWORD' | 'CLAIMED_HASH' | 'NEEDS_BOOTSTRAP'>(
    'NEEDS_BOOTSTRAP'
  );
  const [authChecked, setAuthChecked] = useState(false);
  const [adminState, setAdminState] = useState<AdminStatePayload | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const fetchPublicConfig = useCallback(async () => {
    try {
      const resp = await fetch('/api/v1/public/config');
      const body = await resp.json();
      if (resp.ok && body.code === 0) {
        setPublicConfig(body.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPublic(false);
    }
  }, []);

  const fetchAuthStatus = useCallback(async (token?: string | null) => {
    try {
      const resp = await fetch('/api/v1/admin/auth-status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await resp.json();
      if (resp.ok && body.code === 0 && body.data) {
        setAuthMode(body.data.mode);
        if (!body.data.authenticated && token) {
          setAdminToken(null);
        }
      }
    } catch {
      // ignore
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const fetchAdminState = useCallback(
    async (tokenOverride?: string) => {
      const tok = tokenOverride ?? adminToken;
      if (!tok) return;
      setLoadingAdmin(true);
      try {
        const resp = await fetch('/api/v1/admin/state', {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (resp.status === 401) {
          setAdminToken(null);
          setAdminState(null);
          return;
        }
        const body = await resp.json();
        if (resp.ok && body.code === 0) {
          setAdminState(body.data);
        }
      } finally {
        setLoadingAdmin(false);
      }
    },
    [adminToken]
  );

  useEffect(() => {
    void fetchPublicConfig();
    void fetchAuthStatus();
  }, [fetchPublicConfig, fetchAuthStatus]);

  useEffect(() => {
    if (adminToken && activeTab !== 'cashier') {
      void fetchAdminState();
    }
  }, [adminToken, activeTab, fetchAdminState]);

  const adminFetch = async (url: string, init: RequestInit = {}) => {
    const resp = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...(init.headers || {}),
      },
    });
    const body = await resp.json().catch(() => ({ code: 5000, msg: '服务端响应异常' }));
    if (resp.status === 401) {
      setAdminToken(null);
      setAdminState(null);
    }
    return { ok: resp.ok && body.code === 0, body };
  };

  const handleAdminAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (authMode === 'NEEDS_BOOTSTRAP') {
      if (passwordInput.trim().length < 6) {
        setAuthError('请设置至少 6 位的管理员口令');
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setAuthError('两次输入的口令不一致');
        return;
      }
      setAuthSubmitting(true);
      try {
        const resp = await fetch('/api/v1/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passwordInput }),
        });
        const body = await resp.json();
        if (!resp.ok || body.code !== 0) {
          setAuthError(body.msg || '初始化管理员口令失败');
          return;
        }
        setAdminToken(body.data.token);
        setAuthMode('CLAIMED_HASH');
        setPasswordInput('');
        setConfirmPasswordInput('');
        await fetchAdminState(body.data.token);
      } catch {
        setAuthError('无法连接服务端');
      } finally {
        setAuthSubmitting(false);
      }
      return;
    }

    setAuthSubmitting(true);
    try {
      const resp = await fetch('/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const body = await resp.json();
      if (!resp.ok || body.code !== 0) {
        setAuthError(body.msg || '管理员口令不正确');
        return;
      }
      setAdminToken(body.data.token);
      setPasswordInput('');
      await fetchAdminState(body.data.token);
    } catch {
      setAuthError('无法连接服务端');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Render standalone Mobile Approval Confirmation Page when opened via Feishu / Email / DingTalk link
  if (approveRoute) {
    return (
      <MobileApprovePage
        orderId={approveRoute.orderId}
        token={approveRoute.token}
        onExitToHome={() => {
          setApproveRoute(null);
          window.history.replaceState({}, '', '/');
          void fetchPublicConfig();
          if (adminToken) void fetchAdminState();
        }}
      />
    );
  }

  const isProtectedTab = activeTab !== 'cashier';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('cashier');
            void fetchPublicConfig();
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          DoloPay
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav aria-label="主导航" className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          {(
            [
              { id: 'cashier', label: '收银台' },
              { id: 'orders', label: '订单与核销' },
              { id: 'qrcodes', label: '收款码配置' },
              { id: 'settings', label: '审批与接入' },
            ] as const
          ).map((nav) => {
            const active = activeTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => {
                  setActiveTab(nav.id);
                  if (nav.id === 'cashier') void fetchPublicConfig();
                }}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  active
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
            onClick={() => setActiveTab('settings')}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            配置审批与扩展
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'cashier' && (
          <CashierView
            config={publicConfig}
            loadingConfig={loadingPublic}
            initialOrderId={initialOrderIdFromQuery}
            onNavigateToQrSetup={() => setActiveTab('qrcodes')}
          />
        )}

        {isProtectedTab && !adminToken && (
          <section
            aria-label="管理后台认证"
            className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">
                  {authMode === 'NEEDS_BOOTSTRAP'
                    ? '首次使用：设置管理后台口令'
                    : '管理后台口令验证'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {authMode === 'NEEDS_BOOTSTRAP'
                    ? '未检测到 DOLOPAY_ADMIN_PASSWORD 环境变量，请先为您的实例设置管理员口令'
                    : '收银台保持公开访问，订单核销与收款码配置需管理员登录'}
                </p>
              </div>
            </div>

            {!authChecked ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <form onSubmit={handleAdminAuthSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="admin-pwd" className="block text-xs font-medium text-slate-700 mb-1">
                    {authMode === 'NEEDS_BOOTSTRAP' ? '设置管理员口令（至少 6 位）' : '管理员口令'}
                  </label>
                  <input
                    id="admin-pwd"
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={
                      authMode === 'NEEDS_BOOTSTRAP' ? '输入您自定义的管理口令' : '输入管理员口令'
                    }
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                {authMode === 'NEEDS_BOOTSTRAP' && (
                  <div>
                    <label htmlFor="admin-pwd-confirm" className="block text-xs font-medium text-slate-700 mb-1">
                      再次确认口令
                    </label>
                    <input
                      id="admin-pwd-confirm"
                      type="password"
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="再次输入口令确认"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                {authError && (
                  <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  {authSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4" />
                  )}
                  {authMode === 'NEEDS_BOOTSTRAP' ? '保存口令并进入后台' : '验证口令并登录'}
                </button>
              </form>
            )}
          </section>
        )}

        {isProtectedTab && adminToken && loadingAdmin && !adminState && (
          <div className="bg-white border border-slate-200 rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在同步服务端账单与配置...
          </div>
        )}

        {activeTab === 'orders' && adminToken && adminState && (
          <OrdersAndLedgerView
            adminState={adminState}
            onApproveOrder={async (orderId) => {
              await adminFetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/approve`, {
                method: 'POST',
              });
              await fetchAdminState();
            }}
            onRejectOrder={async (orderId) => {
              await adminFetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/reject`, {
                method: 'POST',
              });
              await fetchAdminState();
            }}
            onRetryWebhook={async (orderId) => {
              await adminFetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/retry-webhook`, {
                method: 'POST',
              });
              await fetchAdminState();
            }}
            onClearDemoOrders={async () => {
              await adminFetch('/api/v1/admin/orders/clear-demo', { method: 'POST' });
              await fetchAdminState();
            }}
            onOpenMobileApprovePreview={(orderId, token) => {
              setApproveRoute({ orderId, token });
              window.history.pushState(
                {},
                '',
                `/approve?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`
              );
            }}
            onRefresh={() => fetchAdminState()}
          />
        )}

        {activeTab === 'qrcodes' && adminToken && adminState && (
          <QrCodeSetupView
            adminState={adminState}
            onUploadQrImage={async (channel: PaymentChannel, dataUrl: string) => {
              const { ok, body } = await adminFetch(`/api/v1/admin/qrcodes/${channel}/upload`, {
                method: 'POST',
                body: JSON.stringify({ dataUrl }),
              });
              if (ok) {
                await fetchAdminState();
                await fetchPublicConfig();
              }
              return { ok, msg: body.msg || (ok ? '上传成功' : '上传失败') };
            }}
            onDeleteQrImage={async (channel: PaymentChannel) => {
              const { ok, body } = await adminFetch(`/api/v1/admin/qrcodes/${channel}/image`, {
                method: 'DELETE',
              });
              if (ok) {
                await fetchAdminState();
                await fetchPublicConfig();
              }
              return { ok, msg: body.msg || (ok ? '已清除' : '操作失败') };
            }}
            onUpdateQrMeta={async (channel, patch) => {
              const { ok, body } = await adminFetch(`/api/v1/admin/qrcodes/${channel}`, {
                method: 'PUT',
                body: JSON.stringify(patch),
              });
              if (ok) {
                await fetchAdminState();
                await fetchPublicConfig();
              }
              return { ok, msg: body.msg || (ok ? '已保存' : '保存失败') };
            }}
            onNavigateToPlugins={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'settings' && adminToken && adminState && (
          <ApprovalAndPluginsView
            adminState={adminState}
            onSaveSettings={async (patch: Partial<GatewaySettings>) => {
              const { ok, body } = await adminFetch('/api/v1/admin/settings', {
                method: 'PUT',
                body: JSON.stringify(patch),
              });
              if (ok) {
                await fetchAdminState();
                await fetchPublicConfig();
              }
              return { ok, msg: body.msg || (ok ? '已保存' : '保存失败') };
            }}
            onTestNotifier={async (channel: ApprovalNotifierId) => {
              const { ok, body } = await adminFetch('/api/v1/admin/notifications/test', {
                method: 'POST',
                body: JSON.stringify({ channel }),
              });
              return { ok, msg: body.msg || (ok ? '测试发送成功' : '测试发送失败') };
            }}
            onCreateApp={async (payload: {
              name: string;
              protocol: IntegrationProtocol;
              notifyUrl: string;
              returnUrl: string;
            }) => {
              const { ok, body } = await adminFetch('/api/v1/admin/apps', {
                method: 'POST',
                body: JSON.stringify(payload),
              });
              if (ok) await fetchAdminState();
              return { ok, msg: body.msg || (ok ? '创建成功' : '创建失败') };
            }}
            onUpdateApp={async (id, patch) => {
              const { ok, body } = await adminFetch(`/api/v1/admin/apps/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
              });
              if (ok) await fetchAdminState();
              return { ok, msg: body.msg || (ok ? '已更新' : '更新失败') };
            }}
            onRotateAppSecret={async (id) => {
              const { ok, body } = await adminFetch(
                `/api/v1/admin/apps/${encodeURIComponent(id)}/rotate-secret`,
                { method: 'POST' }
              );
              if (ok) await fetchAdminState();
              return { ok, msg: body.msg || (ok ? '密钥已重置' : '操作失败') };
            }}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 mt-8">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>DoloPay（独行付）· 面向独立开发者的轻量个人收款码与多渠道审批网关</span>
          </div>
          {adminToken && (
            <button
              type="button"
              onClick={() => {
                setAdminToken(null);
                setAdminState(null);
              }}
              className="text-slate-600 hover:text-slate-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3 h-3" />
              退出管理员登录
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

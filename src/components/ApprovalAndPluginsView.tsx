/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
} from 'lucide-react';
import {
  maskSensitiveSecret,
  type ApprovalNotifierId,
  type FloatStrategy,
  type GatewaySettings,
  type IntegrationProtocol,
} from '../core/dolopayEngine';
import type { OptionalPluginId } from '../core/pluginRegistry';
import { PROTOCOL_META, SMTP_PRESETS } from '../core/seedData';
import type { AdminStatePayload } from '../types/api';

interface ApprovalAndPluginsViewProps {
  adminState: AdminStatePayload;
  onSaveSettings: (patch: Partial<GatewaySettings>) => Promise<{ ok: boolean; msg: string }>;
  onTestNotifier: (channel: ApprovalNotifierId) => Promise<{ ok: boolean; msg: string }>;
  onCreateApp: (payload: {
    name: string;
    protocol: IntegrationProtocol;
    notifyUrl: string;
    returnUrl: string;
  }) => Promise<{ ok: boolean; msg: string }>;
  onUpdateApp: (
    id: string,
    patch: { notifyUrl?: string; returnUrl?: string; enabled?: boolean }
  ) => Promise<{ ok: boolean; msg: string }>;
  onRotateAppSecret: (id: string) => Promise<{ ok: boolean; msg: string }>;
}

export const ApprovalAndPluginsView: React.FC<ApprovalAndPluginsViewProps> = ({
  adminState,
  onSaveSettings,
  onTestNotifier,
  onCreateApp,
  onUpdateApp,
  onRotateAppSecret,
}) => {
  const [settings, setSettings] = useState<GatewaySettings>(adminState.settings);
  const [savingAll, setSavingAll] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingChannel, setTestingChannel] = useState<ApprovalNotifierId | null>(null);
  const [testResults, setTestResults] = useState<
    Partial<Record<ApprovalNotifierId, { ok: boolean; text: string }>>
  >({});

  const [revealSecrets, setRevealSecrets] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Default primary REST app editing state
  const primaryApp = adminState.connectedApps[0];
  const [primaryNotifyUrl, setPrimaryNotifyUrl] = useState(primaryApp?.notifyUrl || '');
  const [primaryReturnUrl, setPrimaryReturnUrl] = useState(primaryApp?.returnUrl || '');
  const [appFeedback, setAppFeedback] = useState<string | null>(null);

  useEffect(() => {
    setSettings(adminState.settings);
  }, [adminState.settings]);

  useEffect(() => {
    setPrimaryNotifyUrl(primaryApp?.notifyUrl || '');
    setPrimaryReturnUrl(primaryApp?.returnUrl || '');
  }, [primaryApp?.id, primaryApp?.notifyUrl, primaryApp?.returnUrl]);

  // Optional EPay / Stripe new app form
  const [newAppName, setNewAppName] = useState('独角数卡 / 外部发卡站');
  const [newAppProto, setNewAppProto] = useState<IntegrationProtocol>('EPAY_COMPAT');
  const [newAppNotifyUrl, setNewAppNotifyUrl] = useState('');

  const handleCopy = (text: string, key: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleSave = async (customSettings?: GatewaySettings) => {
    const payload = customSettings || settings;
    setSavingAll(true);
    setSaveFeedback(null);
    try {
      const res = await onSaveSettings(payload);
      setSaveFeedback({ ok: res.ok, text: res.msg });
      return res.ok;
    } finally {
      setSavingAll(false);
    }
  };

  const handleSaveAndTest = async (channel: ApprovalNotifierId) => {
    setTestingChannel(channel);
    setTestResults((prev) => ({ ...prev, [channel]: undefined }));
    try {
      const savedOk = await handleSave();
      if (!savedOk) return;
      const res = await onTestNotifier(channel);
      setTestResults((prev) => ({ ...prev, [channel]: { ok: res.ok, text: res.msg } }));
    } finally {
      setTestingChannel(null);
    }
  };

  const handleTogglePlugin = async (pluginId: OptionalPluginId) => {
    if (adminState.lockedDisabledPlugins.includes(pluginId)) return;
    const nextSettings: GatewaySettings = {
      ...settings,
      plugins: {
        ...settings.plugins,
        [pluginId]: !settings.plugins[pluginId],
      },
    };
    setSettings(nextSettings);
    await handleSave(nextSettings);
  };

  const activeBaseUrl = settings.publicBaseUrl.trim() || adminState.detectedBaseUrl;
  const activeCoreNotifiersCount = [
    settings.email.enabled,
    settings.feishu.enabled,
    settings.dingtalk.enabled,
  ].filter(Boolean).length;

  return (
    <div className="space-y-8">
      {/* =================================================================== */}
      {/* SECTION 1: Core Default Approval Channels (Email + Feishu + DingTalk) */}
      {/* =================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              默认核心审批通道（邮件 / 飞书 / 钉钉）
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              默认开启零风险的轻量审批方案：可单选也可同时勾选多个通道并发推送，点击通知里的签名链接即可在手机端一键核销（当前已开启 {activeCoreNotifiersCount} 个默认通道）
            </p>
          </div>
          <button
            type="button"
            disabled={savingAll}
            onClick={() => void handleSave()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {savingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            保存全部配置
          </button>
        </div>

        {saveFeedback && (
          <div
            role="status"
            className={`p-3 rounded-lg text-xs border ${
              saveFeedback.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {saveFeedback.text}
          </div>
        )}

        {/* Base Site & Public URL Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">收银台站点标题</label>
            <input
              type="text"
              value={settings.siteTitle}
              onChange={(e) => setSettings({ ...settings, siteTitle: e.target.value })}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-700">
                公网访问地址 PUBLIC_BASE_URL（用于生成通知里的手机审批链接）
              </label>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, publicBaseUrl: adminState.detectedBaseUrl })}
                className="text-[11px] text-blue-600 hover:underline cursor-pointer"
              >
                填入当前地址
              </button>
            </div>
            <input
              type="url"
              value={settings.publicBaseUrl}
              onChange={(e) => setSettings({ ...settings, publicBaseUrl: e.target.value })}
              placeholder={`留空自动使用 ${adminState.detectedBaseUrl}`}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
            />
          </div>
        </div>

        {/* 3 Core Default Approval Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* Card A: Email SMTP */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">1. 邮件审批（SMTP）</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  最轻量零依赖，支持 QQ / 163 / Gmail / Resend
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.email.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      email: { ...settings.email, enabled: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                启用
              </label>
            </div>

            {/* One-Click SMTP Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-slate-500">一键填入常用邮箱服务器：</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {SMTP_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        email: {
                          ...settings.email,
                          enabled: true,
                          host: p.host,
                          port: p.port,
                          secure: p.secure,
                          user: p.id === 'resend' ? 'resend' : settings.email.user,
                        },
                      })
                    }
                    className="px-2 py-1 text-[11px] font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-700 cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">SMTP 主机</label>
                  <input
                    type="text"
                    value={settings.email.host}
                    onChange={(e) =>
                      setSettings({ ...settings, email: { ...settings.email, host: e.target.value } })
                    }
                    placeholder="smtp.qq.com"
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">端口</label>
                  <input
                    type="number"
                    value={settings.email.port}
                    onChange={(e) => {
                      const port = Number(e.target.value) || 465;
                      setSettings({
                        ...settings,
                        email: { ...settings.email, port, secure: port === 465 },
                      });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">发件邮箱账号 (SMTP_USER)</label>
                <input
                  type="text"
                  value={settings.email.user}
                  onChange={(e) =>
                    setSettings({ ...settings, email: { ...settings.email, user: e.target.value } })
                  }
                  placeholder="yourname@qq.com"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">SMTP 授权码 / 密码 (SMTP_PASS)</label>
                <input
                  type="password"
                  value={settings.email.pass}
                  onChange={(e) =>
                    setSettings({ ...settings, email: { ...settings.email, pass: e.target.value } })
                  }
                  placeholder="填入邮箱 16 位授权码"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">接收审批的站长邮箱 (ADMIN_EMAIL)</label>
                <input
                  type="email"
                  value={settings.email.adminTo}
                  onChange={(e) =>
                    setSettings({ ...settings, email: { ...settings.email, adminTo: e.target.value } })
                  }
                  placeholder="可与发件邮箱相同"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={settings.email.sendBuyerReceipt}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      email: { ...settings.email, sendBuyerReceipt: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                核销后同时给买家发确认回执邮件
              </label>
            </div>

            {testResults.email && (
              <div
                className={`p-2.5 rounded-lg text-[11px] border ${
                  testResults.email.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {testResults.email.text}
              </div>
            )}

            <button
              type="button"
              disabled={testingChannel !== null}
              onClick={() => void handleSaveAndTest('email')}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {testingChannel === 'email' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              保存并发送测试邮件
            </button>
          </div>

          {/* Card B: Feishu Bot */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">2. 飞书群机器人审批</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  推送交互审批卡片，手机点按直达确认页
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.feishu.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      feishu: { ...settings.feishu, enabled: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                启用
              </label>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  飞书 Webhook 地址 (FEISHU_WEBHOOK_URL)
                </label>
                <input
                  type="url"
                  value={settings.feishu.webhookUrl}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      feishu: { ...settings.feishu, webhookUrl: e.target.value },
                    })
                  }
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  签名校验密钥（可选，开启飞书签名校验时填写）
                </label>
                <input
                  type="password"
                  value={settings.feishu.secret}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      feishu: { ...settings.feishu, secret: e.target.value },
                    })
                  }
                  placeholder="未开启签名校验请留空"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 leading-relaxed space-y-1">
                <div className="font-semibold text-slate-800">30 秒获取步骤：</div>
                <div>1. 在飞书建一个只有自己的个人群（或团队收款群）；</div>
                <div>2. 群设置 → 群机器人 → 添加「自定义机器人」；</div>
                <div>3. 复制 Webhook 地址（可选勾选「签名校验」）粘贴到上方即可。</div>
              </div>
            </div>

            {testResults.feishu && (
              <div
                className={`p-2.5 rounded-lg text-[11px] border ${
                  testResults.feishu.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {testResults.feishu.text}
              </div>
            )}

            <button
              type="button"
              disabled={testingChannel !== null}
              onClick={() => void handleSaveAndTest('feishu')}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {testingChannel === 'feishu' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              保存并发送测试卡片
            </button>
          </div>

          {/* Card C: DingTalk Bot */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">3. 钉钉群机器人审批</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  推送 ActionCard 审批卡片，支持加签安全校验
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.dingtalk.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      dingtalk: { ...settings.dingtalk, enabled: e.target.checked },
                    })
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                启用
              </label>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  钉钉 Webhook 地址 (DINGTALK_WEBHOOK_URL)
                </label>
                <input
                  type="url"
                  value={settings.dingtalk.webhookUrl}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      dingtalk: { ...settings.dingtalk, webhookUrl: e.target.value },
                    })
                  }
                  placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  加签密钥 SEC...（推荐在钉钉安全设置勾选「加签」）
                </label>
                <input
                  type="password"
                  value={settings.dingtalk.secret}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      dingtalk: { ...settings.dingtalk, secret: e.target.value },
                    })
                  }
                  placeholder="SECxxxxxxxxxxxxxxxx"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 leading-relaxed space-y-1">
                <div className="font-semibold text-slate-800">30 秒获取步骤：</div>
                <div>1. 钉钉群设置 → 智能群助手 → 添加「自定义机器人」；</div>
                <div>2. 安全设置勾选「加签」（或设关键词为 DoloPay）；</div>
                <div>3. 复制 Webhook 与 SEC 密钥粘贴到上方并测试即可。</div>
              </div>
            </div>

            {testResults.dingtalk && (
              <div
                className={`p-2.5 rounded-lg text-[11px] border ${
                  testResults.dingtalk.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {testResults.dingtalk.text}
              </div>
            )}

            <button
              type="button"
              disabled={testingChannel !== null}
              onClick={() => void handleSaveAndTest('dingtalk')}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {testingChannel === 'dingtalk' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              保存并发送测试卡片
            </button>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* SECTION 2: Core REST Open API Integration */}
      {/* =================================================================== */}
      {primaryApp && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">自有网站 REST API 接入（核心内置）</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                只需 1 个下单接口 + 1 个签名回调即可把 DoloPay 嵌入您的个人网站或独立 SaaS
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevealSecrets(!revealSecrets)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              {revealSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {revealSecrets ? '隐藏密钥' : '显示明文密钥'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-slate-500">AppID</div>
                  <div className="font-mono font-semibold text-slate-900 mt-1 flex items-center justify-between gap-2">
                    <span className="truncate">{primaryApp.appId}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(primaryApp.appId, 'appid')}
                      className="text-blue-600 cursor-pointer shrink-0"
                    >
                      {copiedKey === 'appid' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-slate-500">AppSecret (HMAC-SHA256)</div>
                  <div className="font-mono font-semibold text-slate-900 mt-1 flex items-center justify-between gap-2">
                    <span className="truncate">
                      {revealSecrets ? primaryApp.appSecret : maskSensitiveSecret(primaryApp.appSecret)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(primaryApp.appSecret, 'secret')}
                        className="text-blue-600 cursor-pointer"
                        title="复制密钥"
                      >
                        {copiedKey === 'secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await onRotateAppSecret(primaryApp.id);
                          setAppFeedback(res.msg);
                        }}
                        className="text-slate-500 hover:text-slate-900 cursor-pointer"
                        title="重置密钥"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  核销后异步回调地址 notifyUrl（留空则仅作纯收银台不发回调）
                </label>
                <input
                  type="url"
                  value={primaryNotifyUrl}
                  onChange={(e) => setPrimaryNotifyUrl(e.target.value)}
                  placeholder="https://api.yoursite.com/webhooks/dolopay"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  支付成功后买家跳转地址 returnUrl（选填）
                </label>
                <input
                  type="url"
                  value={primaryReturnUrl}
                  onChange={(e) => setPrimaryReturnUrl(e.target.value)}
                  placeholder="https://yoursite.com/order/success"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>

              {appFeedback && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  {appFeedback}
                </div>
              )}

              <button
                type="button"
                onClick={async () => {
                  const res = await onUpdateApp(primaryApp.id, {
                    notifyUrl: primaryNotifyUrl,
                    returnUrl: primaryReturnUrl,
                  });
                  setAppFeedback(res.msg);
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                保存回调配置
              </button>
            </div>

            <div className="lg:col-span-6 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-medium text-slate-800">极简下单请求示例 (POST /api/v1/orders/create)</span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      `POST ${activeBaseUrl}/api/v1/orders/create\nContent-Type: application/json\n\n{"appId":"${primaryApp.appId}","outTradeNo":"ORD_1001","channel":"alipay","amount":"19.90","productTitle":"Pro授权","sign":"<HMAC-SHA256>"}`,
                      'snippet'
                    )
                  }
                  className="text-blue-600 hover:underline cursor-pointer"
                >
                  {copiedKey === 'snippet' ? '已复制' : '复制示例'}
                </button>
              </div>
              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
{`POST ${activeBaseUrl}/api/v1/orders/create
Content-Type: application/json

{
  "appId": "${primaryApp.appId}",
  "outTradeNo": "ORD_20261121_01",
  "channel": "alipay",
  "amount": "19.90",
  "productTitle": "软件永久授权",
  "attach": "userId=1024",
  "sign": "<按参数 ASCII 升序拼接 &key=AppSecret 的 HMAC-SHA256>"
}

// 响应返回 cashierUrl，将买家跳转至该收银台即可`}
              </pre>
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* SECTION 3: Modular Optional Plugins Center (Toggleable & Prunable) */}
      {/* =================================================================== */}
      <section className="space-y-4">
        <div className="pb-3 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">
            模块化扩展中心（Plugins · 按需启用 / 可轻松剪除）
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            以下进阶能力默认关闭，不占用主界面视觉空间；开启后立即展开对应配置，也可通过环境变量{' '}
            <span className="font-mono text-slate-900">DOLOPAY_DISABLED_PLUGINS</span> 在部署时完全屏蔽
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {adminState.pluginRegistry.map((plugin) => {
            const isEnabled = Boolean(settings.plugins[plugin.id]);
            const isLocked = adminState.lockedDisabledPlugins.includes(plugin.id);
            return (
              <div
                key={plugin.id}
                className={`bg-white border rounded-xl p-4 flex items-start justify-between gap-4 transition-colors ${
                  isEnabled ? 'border-blue-300' : 'border-slate-200'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>{plugin.name}</span>
                    {isLocked && (
                      <span className="text-[11px] font-normal text-slate-400">
                        (环境变量已屏蔽)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{plugin.description}</p>
                </div>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => void handleTogglePlugin(plugin.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                    isEnabled
                      ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isEnabled ? '已启用' : '启用插件'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Expanded Configuration Panels for Enabled Optional Plugins */}
        {settings.plugins.bark && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">扩展配置：Bark iOS 实时强提醒</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Bark 推送地址 (BARK_PUSH_URL)</label>
                <input
                  type="url"
                  value={settings.bark.pushUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, bark: { ...settings.bark, pushUrl: e.target.value } })
                  }
                  placeholder="https://api.day.app/你的DeviceKey/"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">通知分组名</label>
                <input
                  type="text"
                  value={settings.bark.group}
                  onChange={(e) =>
                    setSettings({ ...settings, bark: { ...settings.bark, group: e.target.value } })
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            {testResults.bark && (
              <div className={`text-xs p-2.5 rounded-lg border ${testResults.bark.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                {testResults.bark.text}
              </div>
            )}
            <button
              type="button"
              disabled={testingChannel !== null}
              onClick={() => void handleSaveAndTest('bark')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              保存并发送 Bark 测试推送
            </button>
          </div>
        )}

        {settings.plugins.telegram && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">扩展配置：Telegram Bot 审批通知</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bot Token (TELEGRAM_BOT_TOKEN)</label>
                <input
                  type="password"
                  value={settings.telegram.botToken}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      telegram: { ...settings.telegram, botToken: e.target.value },
                    })
                  }
                  placeholder="123456789:AAH..."
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Chat ID (TELEGRAM_CHAT_ID)</label>
                <input
                  type="text"
                  value={settings.telegram.chatId}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      telegram: { ...settings.telegram, chatId: e.target.value },
                    })
                  }
                  placeholder="您的个人 Chat ID 或群组 ID"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            {testResults.telegram && (
              <div className={`text-xs p-2.5 rounded-lg border ${testResults.telegram.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                {testResults.telegram.text}
              </div>
            )}
            <button
              type="button"
              disabled={testingChannel !== null}
              onClick={() => void handleSaveAndTest('telegram')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              保存并发送 Telegram 测试消息
            </button>
          </div>
        )}

        {(settings.plugins.epay || settings.plugins.stripe) && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                扩展配置：多协议应用接入（
                {[settings.plugins.epay && '易支付 EPay', settings.plugins.stripe && 'Stripe Webhook']
                  .filter(Boolean)
                  .join(' / ')}
                ）
              </h3>
              {settings.plugins.epay && (
                <p className="text-xs text-slate-500 mt-1">
                  易支付兼容网关地址：<span className="font-mono text-slate-800">{activeBaseUrl}/api/v1/epay/</span>
                  （在独角数卡 / V2Board / WHMCS 填入该 URL、下方生成的 PID 与密钥即可）
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">接入站点名称</label>
                <input
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">协议类型</label>
                <select
                  value={newAppProto}
                  onChange={(e) => setNewAppProto(e.target.value as IntegrationProtocol)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                >
                  {settings.plugins.epay && <option value="EPAY_COMPAT">易支付通用协议 (MD5)</option>}
                  {settings.plugins.stripe && <option value="STRIPE_WEBHOOK">Stripe 风格 Webhook</option>}
                  <option value="DOLOPAY_REST_V1">DoloPay REST v1</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">默认异步回调 URL</label>
                <input
                  type="url"
                  value={newAppNotifyUrl}
                  onChange={(e) => setNewAppNotifyUrl(e.target.value)}
                  placeholder="https://faka.yoursite.com/notify"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  const res = await onCreateApp({
                    name: newAppName,
                    protocol: newAppProto,
                    notifyUrl: newAppNotifyUrl,
                    returnUrl: '',
                  });
                  setAppFeedback(res.msg);
                }}
                className="py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                新增协议应用
              </button>
            </div>

            {adminState.connectedApps.length > 1 && (
              <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                {adminState.connectedApps.slice(1).map((app) => (
                  <div key={app.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{app.name}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-600">{PROTOCOL_META[app.protocol].shortName}</span>
                      <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                        PID/AppID: {app.appId} · KEY:{' '}
                        {revealSecrets ? app.appSecret : maskSensitiveSecret(app.appSecret)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(`PID=${app.appId}\nKEY=${app.appSecret}`, app.id)}
                      className="text-blue-600 hover:underline cursor-pointer shrink-0"
                    >
                      {copiedKey === app.id ? '已复制凭证' : '复制 PID & KEY'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {settings.plugins.androidListener && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">扩展配置：安卓通知栏监听 Webhook</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                配合闲置安卓机 Tasker / NotificationListener 上报到账通知，支持 ±{settings.webhookReplayWindowSeconds}s 防重放与设备流水号幂等
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Webhook 上报接口</label>
                  <div className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800">
                    POST {activeBaseUrl}/api/v1/webhook/notify
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    监听端 HMAC-SHA256 签名密钥 (DOLOPAY_ANDROID_SECRET)
                  </label>
                  <input
                    type={revealSecrets ? 'text' : 'password'}
                    value={settings.androidWebhookSecret}
                    onChange={(e) =>
                      setSettings({ ...settings, androidWebhookSecret: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  保存监听密钥
                </button>
              </div>
              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
{`// 安卓监听端 POST 报文格式
{
  "channel": "alipay",
  "amountYuan": "19.90",
  "timestamp": 1794811542137,
  "deviceTxId": "ALI_NOTIFY_99812",
  "sign": "<HMAC_SHA256('channel=alipay&amount=19.90&timestamp=...', secret)>"
}`}
              </pre>
            </div>
          </div>
        )}

        {settings.plugins.centFloat && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">扩展配置：并发分位金额浮动锁 (±0.01)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">浮动方向策略</label>
                <select
                  value={settings.floatStrategy}
                  onChange={(e) =>
                    setSettings({ ...settings, floatStrategy: e.target.value as FloatStrategy })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                >
                  <option value="EXACT_THEN_INCREMENT">优先原价，冲突时向上 +0.01 递增</option>
                  <option value="EXACT_THEN_DECREMENT">优先原价，冲突时向下 -0.01 立减</option>
                  <option value="ALWAYS_INCREMENT">始终从 +0.01 起递增</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">最大浮动步数（分）</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.maxFloatSteps}
                  onChange={(e) =>
                    setSettings({ ...settings, maxFloatSteps: Number(e.target.value) || 10 })
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              保存分位浮动策略
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

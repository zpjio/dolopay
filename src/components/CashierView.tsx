/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ImageOff,
  Loader2,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import type { PaymentChannel } from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import type { PublicCashierConfig, PublicOrderStatus } from '../types/api';

interface CashierViewProps {
  config: PublicCashierConfig | null;
  loadingConfig: boolean;
  initialOrderId?: string | null;
  onNavigateToQrSetup: () => void;
}

const QUICK_AMOUNTS = ['9.90', '19.90', '49.00', '99.00'];

export const CashierView: React.FC<CashierViewProps> = ({
  config,
  loadingConfig,
  initialOrderId,
  onNavigateToQrSetup,
}) => {
  const availableChannels = config?.channels.length ? config.channels : (['alipay', 'wechat'] as PaymentChannel[]);

  const [productTitle, setProductTitle] = useState('独立软件永久授权 / 赞赏支持');
  const [amount, setAmount] = useState('19.90');
  const [channel, setChannel] = useState<PaymentChannel>('alipay');
  const [payerNickName, setPayerNickName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerMessage, setPayerMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notifyFeedback, setNotifyFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [activeOrder, setActiveOrder] = useState<PublicOrderStatus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Sync selected channel if enabled channels change
  useEffect(() => {
    if (availableChannels.length > 0 && !availableChannels.includes(channel)) {
      setChannel(availableChannels[0]);
    }
  }, [availableChannels, channel]);

  // Load direct order from URL query (?orderId=...)
  useEffect(() => {
    if (!initialOrderId) return;
    let cancelled = false;
    fetch(`/api/v1/orders/${encodeURIComponent(initialOrderId)}/status`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.code === 0 && res.data) {
          setActiveOrder(res.data);
          setChannel(res.data.channel);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialOrderId]);

  // Countdown tick
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll order status every 3s while awaiting payment or approval
  useEffect(() => {
    if (
      !activeOrder ||
      (activeOrder.status !== 'PENDING_PAYMENT' && activeOrder.status !== 'AWAITING_APPROVAL')
    ) {
      return;
    }

    const poll = setInterval(async () => {
      try {
        const resp = await fetch(`/api/v1/orders/${encodeURIComponent(activeOrder.orderId)}/status`);
        if (!resp.ok) return;
        const body = await resp.json();
        if (body.code === 0 && body.data) {
          setActiveOrder(body.data);
        }
      } catch {
        // ignore transient network errors
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [activeOrder?.orderId, activeOrder?.status]);

  const handleCopy = (text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotifyFeedback(null);

    const trimmedAmount = amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
      setFormError('请输入有效的收款金额（例如 19.90）');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/v1/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productTitle: productTitle.trim() || '个人收款项目',
          amount: trimmedAmount,
          channel,
          payerNickName: payerNickName.trim() || '匿名买家',
          payerEmail: payerEmail.trim(),
          payerMessage: payerMessage.trim(),
        }),
      });
      const body = await resp.json();
      if (!resp.ok || body.code !== 0) {
        setFormError(body.msg || '创建收款单失败');
        return;
      }
      setActiveOrder(body.data);
    } catch {
      setFormError('无法连接到服务端，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclarePaid = async () => {
    if (!activeOrder) return;
    setMarkingPaid(true);
    setFormError(null);
    try {
      const resp = await fetch(
        `/api/v1/orders/${encodeURIComponent(activeOrder.orderId)}/mark-paid`,
        { method: 'POST' }
      );
      const body = await resp.json();
      if (!resp.ok || body.code !== 0) {
        setFormError(body.msg || '提交付款申报失败');
        return;
      }
      setActiveOrder((prev) => (prev ? { ...prev, status: body.data?.status || 'AWAITING_APPROVAL' } : prev));
      setNotifyFeedback(body.msg || '已通知站长核对入账，页面将自动更新状态');
    } catch {
      setFormError('网络请求失败，请稍后重试');
    } finally {
      setMarkingPaid(false);
    }
  };

  const activeQrSlot = activeOrder
    ? config?.qrSlots?.[activeOrder.channel]
    : config?.qrSlots?.[channel];

  const remainingSec = activeOrder
    ? Math.max(0, Math.ceil((activeOrder.expiresAt - nowMs) / 1000))
    : 0;
  const countdownText = `${String(Math.floor(remainingSec / 60)).padStart(2, '0')}:${String(
    remainingSec % 60
  ).padStart(2, '0')}`;

  if (loadingConfig) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在加载收银台配置...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intro Context Strip */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {config?.siteTitle || 'DoloPay 个人收银台'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            个人收款码直连 0% 手续费 · 付款时备注 6 位口令，站长通过
            {config?.enabledNotifiers.length ? ` ${config.enabledNotifiers.join(' / ')} ` : ' 后台 '}
            收到提醒后一键核销
          </p>
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-2 whitespace-nowrap shrink-0">
          <span>当前对账模式</span>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-slate-800">
            {config?.centFloatEnabled ? '分位浮动防冲突 (±0.01)' : '原价 + 6位付款口令'}
          </span>
        </div>
      </div>

      {/* Main Balanced 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 Cols: Order Form */}
        <section
          aria-label="创建收款订单"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">填写付款信息</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              提交后立即生成专属 6 位付款口令与个人收款二维码
            </p>
          </div>

          <form onSubmit={handleCreateOrder} className="space-y-4">
            <div>
              <label htmlFor="cashier-title" className="block text-xs font-medium text-slate-700 mb-1.5">
                商品或支持项目
              </label>
              <input
                id="cashier-title"
                type="text"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="例如：软件授权、咖啡赞赏"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="cashier-amount" className="text-xs font-medium text-slate-700">
                  支付金额（元）
                </label>
                <div className="flex items-center gap-1.5">
                  {QUICK_AMOUNTS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(preset)}
                      className={`px-2 py-0.5 text-xs font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                        amount === preset
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ¥{preset}
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="cashier-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2.5 text-lg font-mono tabular-nums font-bold bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">选择付款方式</span>
              <div className={`grid gap-2 ${availableChannels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {availableChannels.map((ch) => {
                  const meta = CHANNEL_META[ch];
                  const selected = channel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`py-2.5 px-3 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                        selected
                          ? `${meta.softBg} ${meta.border} ${meta.accentText}`
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {meta.shortName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="cashier-nick" className="block text-xs font-medium text-slate-700 mb-1.5">
                  您的称呼（选填）
                </label>
                <input
                  id="cashier-nick"
                  type="text"
                  value={payerNickName}
                  onChange={(e) => setPayerNickName(e.target.value)}
                  placeholder="方便站长核对"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
              <div>
                <label htmlFor="cashier-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                  通知邮箱（选填）
                </label>
                <input
                  id="cashier-email"
                  type="email"
                  value={payerEmail}
                  onChange={(e) => setPayerEmail(e.target.value)}
                  placeholder="用于接收确认回执"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cashier-msg" className="block text-xs font-medium text-slate-700 mb-1.5">
                备注说明（选填）
              </label>
              <input
                id="cashier-msg"
                type="text"
                value={payerMessage}
                onChange={(e) => setPayerMessage(e.target.value)}
                placeholder="例如：GitHub 账号、订单备注"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {formError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              生成收款二维码
            </button>
          </form>
        </section>

        {/* Right 7 Cols: Active Payment QR Desk */}
        <section
          aria-label="扫码付款台"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6"
        >
          {!activeOrder ? (
            <div className="py-12 flex flex-col items-center text-center max-w-md mx-auto space-y-4">
              {activeQrSlot?.hasImage && activeQrSlot.imageUrl ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <img
                    src={activeQrSlot.imageUrl}
                    alt={`${CHANNEL_META[channel].shortName}收款码预览`}
                    referrerPolicy="no-referrer"
                    className="w-44 h-44 object-contain rounded-lg bg-white"
                  />
                </div>
              ) : (
                <div className="w-44 h-44 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center p-4 text-slate-500">
                  <ImageOff className="w-7 h-7 text-slate-400 mb-2" />
                  <span className="text-xs font-medium text-slate-700">尚未配置个人收款码</span>
                  <span className="text-[11px] text-slate-500 mt-1">
                    上传图片或放入 public/qrcodes/
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  确认左侧金额后，点击「生成收款二维码」
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  系统会生成专属 6 位付款口令。付款完成后点击「我已支付」，站长将在手机端收到飞书 / 邮件 / 钉钉审批卡片，确认后本页自动更新。
                </p>
              </div>

              {!activeQrSlot?.hasImage && (
                <button
                  type="button"
                  onClick={onNavigateToQrSetup}
                  className="px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                >
                  前往「收款码配置」上传我的收款码
                </button>
              )}
            </div>
          ) : activeOrder.status === 'PAID' ? (
            <div className="py-10 flex flex-col items-center text-center space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">收款已确认入账</h2>
                <p className="text-sm text-slate-600">{activeOrder.productTitle}</p>
              </div>
              <div className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
                ¥{activeOrder.actualAmountYuan}
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap justify-center">
                <span className="font-mono">订单 {activeOrder.orderId}</span>
                <span aria-hidden="true">·</span>
                <span>{CHANNEL_META[activeOrder.channel].shortName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">口令 {activeOrder.remarkCode}</span>
              </div>
              <div className="flex items-center gap-3 pt-2">
                {activeOrder.returnUrl && /^https?:\/\//i.test(activeOrder.returnUrl) && (
                  <a
                    href={activeOrder.returnUrl}
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    返回商户页面
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveOrder(null);
                    setNotifyFeedback(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                >
                  发起新收款
                </button>
              </div>
            </div>
          ) : activeOrder.status === 'REJECTED' || activeOrder.status === 'EXPIRED' ? (
            <div className="py-10 flex flex-col items-center text-center space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
                <XCircle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {activeOrder.status === 'REJECTED' ? '付款申报未通过核验' : '收款单已超时关闭'}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeOrder.status === 'REJECTED'
                    ? '站长未在账单中查找到对应入账，如已扣款请联系站长核实订单号。'
                    : '请在有效期内完成扫码，或重新发起收款单。'}
                </p>
              </div>
              <div className="text-xs font-mono text-slate-500">订单号 {activeOrder.orderId}</div>
              <button
                type="button"
                onClick={() => {
                  setActiveOrder(null);
                  setNotifyFeedback(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                重新创建收款单
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Order Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span className={`font-semibold ${CHANNEL_META[activeOrder.channel].accentText}`}>
                      {CHANNEL_META[activeOrder.channel].name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{activeOrder.orderId}</span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {activeOrder.productTitle}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-600 shrink-0">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>剩余 {countdownText}</span>
                </div>
              </div>

              {/* QR Image + Key Payment Info */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                <div className="md:col-span-5 flex flex-col items-center">
                  {activeQrSlot?.hasImage && activeQrSlot.imageUrl ? (
                    <div className="p-3 bg-white border border-slate-200 rounded-xl">
                      <img
                        src={activeQrSlot.imageUrl}
                        alt={`${CHANNEL_META[activeOrder.channel].shortName}收款二维码`}
                        referrerPolicy="no-referrer"
                        className="w-52 h-52 object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="w-52 h-52 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 flex flex-col items-center justify-center p-4 text-center space-y-2">
                      <ImageOff className="w-7 h-7 text-amber-600" />
                      <div className="text-xs font-semibold text-amber-900">未上传个人收款码图片</div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        请在管理后台「收款码配置」上传原图，或放入{' '}
                        <span className="font-mono">{CHANNEL_META[activeOrder.channel].staticFileHint}</span>
                      </p>
                      <button
                        type="button"
                        onClick={onNavigateToQrSetup}
                        className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        立即配置收款码
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-slate-500 mt-2.5 text-center">
                    {CHANNEL_META[activeOrder.channel].appHint}
                  </p>
                  {activeQrSlot?.accountMask && (
                    <p className="text-[11px] text-slate-400 mt-0.5 text-center">
                      收款方：{activeQrSlot.accountMask}
                    </p>
                  )}
                </div>

                <div className="md:col-span-7 space-y-4">
                  {/* Amount Row */}
                  <div className="pb-3 border-b border-slate-100">
                    <div className="text-xs text-slate-500">请支付准确金额</div>
                    <div className="mt-1 flex items-baseline gap-2.5">
                      <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                        ¥{activeOrder.actualAmountYuan}
                      </span>
                      {activeOrder.actualAmountYuan !== activeOrder.nominalAmountYuan && (
                        <span className="text-xs text-amber-700 font-medium">
                          原价 ¥{activeOrder.nominalAmountYuan}（已防冲突微调）
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(activeOrder.actualAmountYuan, 'amount')}
                        className="ml-auto text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        {copiedKey === 'amount' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === 'amount' ? '已复制' : '复制金额'}
                      </button>
                    </div>
                  </div>

                  {/* 6-Digit Remark Code */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600">
                        付款备注口令（扫码转账时请填在备注栏）
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(activeOrder.remarkCode, 'remark')}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        {copiedKey === 'remark' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey === 'remark' ? '已复制口令' : '复制口令'}
                      </button>
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums tracking-widest text-slate-900">
                      {activeOrder.remarkCode}
                    </div>
                    <p className="text-xs text-slate-500">
                      {activeQrSlot?.paymentTip || '付款后点击下方按钮通知站长核对入账'}
                    </p>
                  </div>

                  {/* Action Area */}
                  {activeOrder.status === 'PENDING_PAYMENT' ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={markingPaid}
                        onClick={handleDeclarePaid}
                        className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        {markingPaid ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        我已支付
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveOrder(null)}
                        className="w-full py-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        取消并返回修改金额
                      </button>
                    </div>
                  ) : (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                        <span>已提交付款申报，等待站长一键核销中...</span>
                      </div>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        {notifyFeedback ||
                          '站长在手机点击审批确认后，本页面每 3 秒自动同步状态，无需手动刷新。'}
                      </p>
                      <button
                        type="button"
                        disabled={markingPaid}
                        onClick={handleDeclarePaid}
                        className="text-xs font-medium text-amber-900 hover:underline cursor-pointer"
                      >
                        长时间未收到回应？重新提醒站长
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

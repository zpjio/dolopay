import React, { useState } from 'react';
import {
  QrCode,
  ShieldCheck,
  Smartphone,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Send,
  Layers,
  Zap,
  RefreshCw,
  MailCheck,
  XCircle,
} from 'lucide-react';
import {
  centsToYuan,
  computeDoloPaySignature,
  isOrderHoldingAmountLock,
  type PaymentChannel,
  type SystemRiskConfig,
  type DoloPayOrder,
  type WebhookNotifyPayload,
} from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import { QrCodeMatrixSvg } from './QrCodeMatrixSvg';

interface CashierSandboxViewProps {
  orders: DoloPayOrder[];
  riskConfig: SystemRiskConfig;
  nowMs: number;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onCreateOrder: (params: {
    productTitle: string;
    nominalAmountYuan: string;
    channel: PaymentChannel;
    payerNickName: string;
    payerEmail: string;
    payerMessage: string;
    clientIp: string;
  }) => { ok: boolean; order?: DoloPayOrder; errorMessage?: string };
  onMarkUserPaid: (orderId: string) => void;
  onApproveOrder: (orderId: string, method: 'EMAIL_TOKEN_APPROVAL' | 'MANUAL_RECONCILE') => void;
  onRejectOrder: (orderId: string) => void;
  onTriggerWebhook: (payload: WebhookNotifyPayload) => { ok: boolean; message: string };
}

const PRESET_PRODUCTS = [
  { title: 'DoloPay Pro 个人免签商业授权（永久版）', amount: '10.00' },
  { title: 'API 流量包 50,000 次自动发卡充值', amount: '29.90' },
  { title: '开源项目咖啡赞赏 · 黄金赞助者', amount: '68.00' },
  { title: '独立节点年付订阅 (Pro Node)', amount: '99.00' },
];

export const CashierSandboxView: React.FC<CashierSandboxViewProps> = ({
  orders,
  riskConfig,
  nowMs,
  selectedOrderId,
  onSelectOrder,
  onCreateOrder,
  onMarkUserPaid,
  onApproveOrder,
  onRejectOrder,
  onTriggerWebhook,
}) => {
  const [productTitle, setProductTitle] = useState(PRESET_PRODUCTS[0].title);
  const [nominalAmountYuan, setNominalAmountYuan] = useState(PRESET_PRODUCTS[0].amount);
  const [channel, setChannel] = useState<PaymentChannel>('alipay');
  const [payerNickName, setPayerNickName] = useState('张维 (独立开发者)');
  const [payerEmail, setPayerEmail] = useState('zhangwei@indie.cn');
  const [payerMessage, setPayerMessage] = useState('购买 DoloPay Pro 授权，请发送下载链接');
  const [clientIp, setClientIp] = useState('114.247.88.102');
  const [formFeedback, setFormFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Webhook simulator state
  const [simChannel, setSimChannel] = useState<PaymentChannel>('alipay');
  const [simAmountYuan, setSimAmountYuan] = useState('10.00');
  const [simDeviceTxId, setSimDeviceTxId] = useState(`ALI_NOTIFY_${Date.now().toString().slice(-6)}`);
  const [simTamperSign, setSimTamperSign] = useState(false);
  const [simExpiredTimestamp, setSimExpiredTimestamp] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const activeOrder =
    orders.find((o) => o.id === selectedOrderId) ||
    orders.find((o) => isOrderHoldingAmountLock(o, nowMs)) ||
    orders[0] ||
    null;

  const activeLocks = orders.filter((o) => isOrderHoldingAmountLock(o, nowMs));

  const handleCopy = (value: string, label: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setFormFeedback(null);

    if (!productTitle.trim()) {
      setFormFeedback({ type: 'error', text: '请输入商品或收款项目名称' });
      return;
    }
    if (!payerEmail.trim() || !payerEmail.includes('@')) {
      setFormFeedback({ type: 'error', text: '请输入有效的付款人通知邮箱（用于接收自动发卡与核销回执）' });
      return;
    }

    const res = onCreateOrder({
      productTitle: productTitle.trim(),
      nominalAmountYuan: nominalAmountYuan.trim(),
      channel,
      payerNickName: payerNickName.trim() || '匿名付款人',
      payerEmail: payerEmail.trim(),
      payerMessage: payerMessage.trim(),
      clientIp: clientIp.trim() || '127.0.0.1',
    });

    if (!res.ok) {
      setFormFeedback({ type: 'error', text: res.errorMessage || '创建订单失败' });
      return;
    }

    if (res.order) {
      const actualStr = centsToYuan(res.order.actualAmountCents);
      const nominalStr = centsToYuan(res.order.nominalAmountCents);
      setSimChannel(res.order.channel);
      setSimAmountYuan(actualStr);
      setSimDeviceTxId(`${res.order.channel.toUpperCase()}_TX_${Math.floor(100000 + Math.random() * 900000)}`);
      setFormFeedback({
        type: 'success',
        text:
          res.order.actualAmountCents !== res.order.nominalAmountCents
            ? `已创建订单 ${res.order.id}：原价 ¥${nominalStr} 已被占用，系统自动分配唯一防冲突实付金额 ¥${actualStr}`
            : `已创建订单 ${res.order.id}：已锁定唯一实付金额 ¥${actualStr}`,
      });
    }
  };

  const handleQuickConcurrentBurst = () => {
    // Rapidly create a concurrent ¥10.00 order with a fresh IP to demonstrate dynamic amount floating
    const randomIp = `202.106.${Math.floor(10 + Math.random() * 200)}.${Math.floor(10 + Math.random() * 200)}`;
    const res = onCreateOrder({
      productTitle: 'DoloPay Pro 个人免签商业授权（并发压力测试）',
      nominalAmountYuan: nominalAmountYuan.trim() || '10.00',
      channel,
      payerNickName: `并发买家 #${Math.floor(100 + Math.random() * 899)}`,
      payerEmail: `buyer${Math.floor(100 + Math.random() * 899)}@example.com`,
      payerMessage: '并发同额立减/递增防冲突测试',
      clientIp: randomIp,
    });

    if (!res.ok) {
      setFormFeedback({ type: 'error', text: res.errorMessage || '并发创建失败' });
    } else if (res.order) {
      const actualStr = centsToYuan(res.order.actualAmountCents);
      setSimChannel(res.order.channel);
      setSimAmountYuan(actualStr);
      setSimDeviceTxId(`${res.order.channel.toUpperCase()}_TX_${Math.floor(100000 + Math.random() * 900000)}`);
      setFormFeedback({
        type: 'success',
        text: `并发测试单 ${res.order.id} 创建成功！锁定实付金额 ¥${actualStr}（原价 ¥${centsToYuan(res.order.nominalAmountCents)}）`,
      });
    }
  };

  const handleFireSimulatedWebhook = (targetChannel?: PaymentChannel, targetAmountYuan?: string) => {
    const useChannel = targetChannel ?? simChannel;
    const useAmount = targetAmountYuan ?? simAmountYuan;
    // If simulating a replay attack, send a timestamp 10 minutes (600s) in the past (> ±300s window)
    const ts = simExpiredTimestamp ? nowMs - 600_000 : nowMs;
    const validSign = computeDoloPaySignature(useChannel, useAmount, ts, riskConfig.webhookSecretKey);
    const signToUse = simTamperSign ? '0000deadbeef_invalid_hmac_signature_9999' : validSign;

    const result = onTriggerWebhook({
      channel: useChannel,
      amountYuan: useAmount,
      timestamp: ts,
      deviceTxId: simDeviceTxId.trim() || `TX_${ts}`,
      sign: signToUse,
    });

    setWebhookFeedback({ ok: result.ok, text: result.message });
    if (result.ok) {
      setSimDeviceTxId(`${useChannel.toUpperCase()}_TX_${Math.floor(100000 + Math.random() * 900000)}`);
    }
  };

  const remainingSeconds = activeOrder
    ? Math.max(0, Math.ceil((activeOrder.expiresAt - nowMs) / 1000))
    : 0;
  const minutesStr = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secondsStr = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <div className="space-y-6">
      {/* Top Architecture Explain Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-800">DoloPay 核心免签闭环原理</span>
            <span aria-hidden="true">·</span>
            <span>动态金额防冲突锁 (Unique Cent Lock)</span>
            <span aria-hidden="true">·</span>
            <span>指定金额固码优先匹配</span>
            <span aria-hidden="true">·</span>
            <span>App 监听 Webhook + 邮件双轨核销</span>
          </div>
          <p className="text-sm text-slate-600">
            解决个人静态收款码无法携带商户订单号的核心痛点：同一时段同渠道并发下单时，系统自动在标称金额基础上分配唯一分位金额（如
            <span className="font-mono font-medium text-slate-900 mx-1">¥10.00 → ¥10.01 → ¥10.02</span>
            ），配合手机端通知监听或 DoloPay 邮件一键审批实现 100% 精准对账。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleQuickConcurrentBurst}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            并发压测：再下一笔同额订单
          </button>
        </div>
      </div>

      {/* Main 12-Col Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 4 Cols: Order Creation Form */}
        <section
          aria-label="发起收款单配置"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">01. 发起收款测试单</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              模拟下游业务或客户在收银台提交订单，自动锁定唯一应付金额
            </p>
          </div>

          <form onSubmit={handleSubmitOrder} className="space-y-3.5">
            <div>
              <label htmlFor="preset-select" className="block text-xs font-medium text-slate-700 mb-1">
                快捷商品预设
              </label>
              <select
                id="preset-select"
                value={productTitle}
                onChange={(e) => {
                  const found = PRESET_PRODUCTS.find((p) => p.title === e.target.value);
                  setProductTitle(e.target.value);
                  if (found) setNominalAmountYuan(found.amount);
                }}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
              >
                {PRESET_PRODUCTS.map((p) => (
                  <option key={p.title} value={p.title}>
                    {p.title} (¥{p.amount})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="product-title-input" className="block text-xs font-medium text-slate-700 mb-1">
                商品 / 收款项目名称
              </label>
              <input
                id="product-title-input"
                type="text"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                placeholder="例如：DoloPay Pro 商业授权"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nominal-amount-input" className="block text-xs font-medium text-slate-700 mb-1">
                  订单原价 (元)
                </label>
                <input
                  id="nominal-amount-input"
                  type="text"
                  value={nominalAmountYuan}
                  onChange={(e) => setNominalAmountYuan(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-semibold bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  placeholder="10.00"
                />
              </div>

              <div>
                <label htmlFor="client-ip-input" className="block text-xs font-medium text-slate-700 mb-1">
                  请求来源 IP (限流校验)
                </label>
                <input
                  id="client-ip-input"
                  type="text"
                  value={clientIp}
                  onChange={(e) => setClientIp(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">选择个人收款码渠道</span>
              <div className="grid grid-cols-3 gap-2">
                {(['alipay', 'wechat', 'unionpay'] as PaymentChannel[]).map((ch) => {
                  const active = channel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`py-2 px-2.5 text-xs font-medium rounded-lg border text-center transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {CHANNEL_META[ch].shortName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="payer-nickname-input" className="block text-xs font-medium text-slate-700 mb-1">
                  付款人昵称 / 标识
                </label>
                <input
                  id="payer-nickname-input"
                  type="text"
                  value={payerNickName}
                  onChange={(e) => setPayerNickName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label htmlFor="payer-email-input" className="block text-xs font-medium text-slate-700 mb-1">
                  接收回执邮箱 (必填)
                </label>
                <input
                  id="payer-email-input"
                  type="email"
                  value={payerEmail}
                  onChange={(e) => setPayerEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
                  placeholder="user@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="payer-message-input" className="block text-xs font-medium text-slate-700 mb-1">
                付款留言 / 发卡备注
              </label>
              <input
                id="payer-message-input"
                type="text"
                value={payerMessage}
                onChange={(e) => setPayerMessage(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
              />
            </div>

            {formFeedback && (
              <div
                role="status"
                className={`p-3 rounded-lg text-xs border ${
                  formFeedback.type === 'error'
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {formFeedback.text}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              生成唯一金额收款单
            </button>
          </form>
        </section>

        {/* Center 4 Cols: Live Customer QR Checkout Desk */}
        <section
          aria-label="DoloPay 个人收款码收银台"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">02. 客户扫码收银台</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeOrder ? `单号 ${activeOrder.id} · ${CHANNEL_META[activeOrder.channel].name}` : '暂无选中订单'}
              </p>
            </div>
            {activeOrder && (
              <span className="text-xs font-mono tabular-nums text-slate-600">
                {activeOrder.status === 'PAID'
                  ? '状态：已核销到账'
                  : activeOrder.status === 'AWAITING_APPROVAL'
                  ? '状态：待邮件/后台核销'
                  : activeOrder.status === 'EXPIRED'
                  ? '状态：已超时释放'
                  : activeOrder.status === 'REJECTED'
                  ? '状态：已驳回'
                  : `倒计时 ${minutesStr}:${secondsStr}`}
              </span>
            )}
          </div>

          {activeOrder ? (
            <div className="space-y-4">
              {/* Amount Callout Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center space-y-1.5">
                <div className="text-xs text-slate-500">
                  请严格按照下方<strong className="text-slate-900 font-semibold">实付锁定金额</strong>扫码付款
                </div>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    ¥{centsToYuan(activeOrder.actualAmountCents)}
                  </span>
                  {activeOrder.actualAmountCents !== activeOrder.nominalAmountCents && (
                    <span className="text-xs font-mono tabular-nums text-slate-400 line-through">
                      原价 ¥{centsToYuan(activeOrder.nominalAmountCents)}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 flex-wrap">
                  <span>
                    {activeOrder.qrMatchType === 'FIXED_EXACT'
                      ? '已匹配指定金额固码（扫码免手动输金额）'
                      : '通用收款码（扫码后需输入上述实付金额）'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(centsToYuan(activeOrder.actualAmountCents), 'amount')}
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    {copiedField === 'amount' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedField === 'amount' ? '已复制金额' : '复制实付金额'}
                  </button>
                </div>
              </div>

              {/* QR Matrix Display */}
              <div className="flex flex-col items-center justify-center space-y-2.5">
                <QrCodeMatrixSvg
                  payload={`${activeOrder.qrPayloadUrl}?order=${activeOrder.id}&amt=${activeOrder.actualAmountCents}`}
                  channel={activeOrder.channel}
                  size={192}
                  expired={activeOrder.status === 'EXPIRED' || activeOrder.status === 'REJECTED'}
                />

                <div className="text-xs text-slate-600 flex items-center gap-2">
                  <span>{CHANNEL_META[activeOrder.channel].appHint}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    备注口令: <strong className="text-slate-900">{activeOrder.remarkCode}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(activeOrder.remarkCode, 'remark')}
                    className="text-blue-600 hover:underline text-[11px] cursor-pointer"
                  >
                    {copiedField === 'remark' ? '已复制' : '复制口令'}
                  </button>
                </div>
              </div>

              {/* Order Status Banner or Action Buttons */}
              {activeOrder.status === 'PAID' ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>收款已核销入账 (¥{centsToYuan(activeOrder.actualAmountCents)})</span>
                  </div>
                  <p className="text-xs text-emerald-700">
                    核销方式：
                    {activeOrder.settlementMethod === 'AUTO_WEBHOOK'
                      ? '移动端收款通知 Webhook 自动核销'
                      : activeOrder.settlementMethod === 'EMAIL_TOKEN_APPROVAL'
                      ? 'DoloPay 管理员邮件一键审批通过'
                      : '异常掉单人工补单核销'}
                    ，金额锁已释放归还池中。
                  </p>
                </div>
              ) : activeOrder.status === 'AWAITING_APPROVAL' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900">
                      已收到买家“我已支付”申报，等待核销确认
                    </span>
                    <span className="text-[11px] font-mono text-amber-700">
                      Token: {activeOrder.approvalToken.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-xs text-amber-800">
                    DoloPay 已向管理员邮箱 ({riskConfig.adminEmail}) 发送含专属签名 Token 的快捷核销邮件，您可在此直接模拟点击邮件内的审批链接：
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onApproveOrder(activeOrder.id, 'EMAIL_TOKEN_APPROVAL')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <MailCheck className="w-3.5 h-3.5" />
                      邮件一键确认收款
                    </button>
                    <button
                      type="button"
                      onClick={() => onRejectOrder(activeOrder.id)}
                      className="inline-flex items-center justify-center gap-1 py-2 px-3 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      驳回假付
                    </button>
                  </div>
                </div>
              ) : activeOrder.status === 'PENDING_PAYMENT' ? (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleFireSimulatedWebhook(
                          activeOrder.channel,
                          centsToYuan(activeOrder.actualAmountCents)
                        )
                      }
                      className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      模拟App监听秒到回调
                    </button>
                    <button
                      type="button"
                      onClick={() => onMarkUserPaid(activeOrder.id)}
                      className="py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      买家点击：我已支付
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 text-center">
                    提示：点击左侧可验证 App 监听自动回调秒级核销；点击右侧可体验 DoloPay 邮件审批核销流。
                  </p>
                </div>
              ) : (
                <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-xs text-slate-600">
                    该订单已{activeOrder.status === 'EXPIRED' ? '超时释放金额锁' : '被驳回'}，如买家实际已付款可执行补单：
                  </span>
                  <button
                    type="button"
                    onClick={() => onApproveOrder(activeOrder.id, 'MANUAL_RECONCILE')}
                    className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    掉单人工补单
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        {/* Right 4 Cols: Active Amount Lock Pool & Mobile Listener Webhook Simulator */}
        <section
          aria-label="实时金额锁池与移动端监听模拟器"
          className="lg:col-span-4 space-y-5"
        >
          {/* Live Lock Pool Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">03. 实时金额锁占用矩阵</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  当前共有 <strong className="font-mono text-slate-900">{activeLocks.length}</strong> 个唯一金额槽位正在锁定中
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                TTL: {riskConfig.orderTtlSeconds}s
              </span>
            </div>

            {activeLocks.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                当前无占用中的金额锁，所有原价槽位均可直接分配
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto pr-1">
                {activeLocks.map((lockOrder) => {
                  const leftSec = Math.max(0, Math.ceil((lockOrder.expiresAt - nowMs) / 1000));
                  const isSelected = activeOrder?.id === lockOrder.id;
                  return (
                    <div
                      key={lockOrder.id}
                      className={`py-2.5 px-2 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectOrder(lockOrder.id)}
                        className="text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {CHANNEL_META[lockOrder.channel].shortName}
                          </span>
                          <span className="font-mono tabular-nums text-sm font-bold text-blue-700">
                            ¥{centsToYuan(lockOrder.actualAmountCents)}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 truncate">
                            ({lockOrder.id})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {lockOrder.payerNickName} · 剩余 {leftSec}s 释放
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleFireSimulatedWebhook(
                            lockOrder.channel,
                            centsToYuan(lockOrder.actualAmountCents)
                          )
                        }
                        className="px-2.5 py-1.5 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        回调核销
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile App Listener Webhook Simulator */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">移动端收款通知 Webhook 调试器</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  模拟安卓监听端捕获“支付宝/微信收款到账”通知并上报签名报文
                </p>
              </div>
              <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="sim-channel-select" className="block text-xs font-medium text-slate-700 mb-1">
                  监听通知渠道
                </label>
                <select
                  id="sim-channel-select"
                  value={simChannel}
                  onChange={(e) => setSimChannel(e.target.value as PaymentChannel)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
                >
                  <option value="alipay">支付宝 (Alipay)</option>
                  <option value="wechat">微信支付 (WeChat)</option>
                  <option value="unionpay">云闪付 (UnionPay)</option>
                </select>
              </div>

              <div>
                <label htmlFor="sim-amount-input" className="block text-xs font-medium text-slate-700 mb-1">
                  通知播报金额 (元)
                </label>
                <input
                  id="sim-amount-input"
                  type="text"
                  value={simAmountYuan}
                  onChange={(e) => setSimAmountYuan(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums font-semibold bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sim-txid-input" className="block text-xs font-medium text-slate-700 mb-1">
                设备通知唯一流水号 (防重放幂等校验)
              </label>
              <input
                id="sim-txid-input"
                type="text"
                value={simDeviceTxId}
                onChange={(e) => setSimDeviceTxId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700"
              />
            </div>

            <div className="space-y-1.5 text-xs text-slate-600 pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={simTamperSign}
                  onChange={(e) => setSimTamperSign(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>模拟伪造 HMAC-SHA256 签名攻击 (测试常量时间验签拦截)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={simExpiredTimestamp}
                  onChange={(e) => setSimExpiredTimestamp(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>模拟过期时间戳重放攻击 (发送 10 分钟前旧报文测试 ±300s 窗口)</span>
              </label>
            </div>

            {webhookFeedback && (
              <div
                role="status"
                className={`p-2.5 rounded-lg text-xs border ${
                  webhookFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {webhookFeedback.text}
              </div>
            )}

            <button
              type="button"
              onClick={() => handleFireSimulatedWebhook()}
              className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              发送签名 Webhook 回调报文
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

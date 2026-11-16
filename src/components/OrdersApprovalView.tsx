import React, { useState } from 'react';
import {
  Search,
  MailCheck,
  XCircle,
  RotateCcw,
  FileCode2,
  RefreshCw,
} from 'lucide-react';
import {
  centsToYuan,
  buildMerchantWebhookEnvelope,
  type ConnectedApp,
  type OrderStatus,
  type SystemRiskConfig,
  type DoloPayOrder,
} from '../core/dolopayEngine';
import { CHANNEL_META, PROTOCOL_META } from '../core/seedData';

interface OrdersApprovalViewProps {
  orders: DoloPayOrder[];
  connectedApps: ConnectedApp[];
  riskConfig: SystemRiskConfig;
  initialStatusFilter?: string;
  onApproveOrder: (orderId: string, method: 'EMAIL_TOKEN_APPROVAL' | 'MANUAL_RECONCILE') => void;
  onRejectOrder: (orderId: string) => void;
  onRetryMerchantWebhook: (orderId: string) => void;
}

const STATUS_LABELS: Record<OrderStatus, { label: string; textClass: string }> = {
  PENDING_PAYMENT: { label: '待扫码支付 (锁占用)', textClass: 'text-blue-700 font-medium' },
  AWAITING_APPROVAL: { label: '已申报付款 · 待核销', textClass: 'text-amber-700 font-semibold' },
  PAID: { label: '已核销入账', textClass: 'text-emerald-700 font-semibold' },
  EXPIRED: { label: '超时未付 (锁已释放)', textClass: 'text-slate-500' },
  REJECTED: { label: '已驳回假付', textClass: 'text-rose-600 font-medium' },
};

export const OrdersApprovalView: React.FC<OrdersApprovalViewProps> = ({
  orders,
  connectedApps,
  riskConfig,
  initialStatusFilter = 'ALL',
  onApproveOrder,
  onRejectOrder,
  onRetryMerchantWebhook,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [appFilter, setAppFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectedOrderId, setInspectedOrderId] = useState<string | null>(orders[0]?.id ?? null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  React.useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const awaitingOrders = orders.filter((o) => o.status === 'AWAITING_APPROVAL');

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
    if (appFilter !== 'ALL' && o.appId !== appFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      o.outTradeNo.toLowerCase().includes(q) ||
      o.payerNickName.toLowerCase().includes(q) ||
      o.payerEmail.toLowerCase().includes(q) ||
      (o.attach && o.attach.toLowerCase().includes(q)) ||
      o.remarkCode.includes(q)
    );
  });

  const inspectedOrder =
    orders.find((o) => o.id === inspectedOrderId) || filteredOrders[0] || orders[0] || null;

  const matchedConnectedApp = inspectedOrder
    ? connectedApps.find((a) => a.appId === inspectedOrder.appId)
    : undefined;

  const webhookEnvelope = inspectedOrder
    ? buildMerchantWebhookEnvelope({
        order: inspectedOrder,
        connectedApp: matchedConnectedApp,
        fallbackCallbackUrl: riskConfig.merchantCallbackUrl,
        fallbackSecretKey: riskConfig.webhookSecretKey,
        nowMs: inspectedOrder.paidAt || inspectedOrder.createdAt,
      })
    : null;

  const triggerApprove = (orderId: string, method: 'EMAIL_TOKEN_APPROVAL' | 'MANUAL_RECONCILE') => {
    onApproveOrder(orderId, method);
    setActionNotice(
      method === 'MANUAL_RECONCILE'
        ? `已对订单 ${orderId} 执行掉单人工补单，并按接入协议触发外部系统异步通知`
        : `已通过订单 ${orderId} 的收款核销，已自动触发外部系统异步回调与买家发卡邮件`
    );
  };

  const triggerReject = (orderId: string) => {
    onRejectOrder(orderId);
    setActionNotice(`已驳回订单 ${orderId} 的付款申报，对应金额锁已立即释放`);
  };

  const triggerRetryWebhook = (orderId: string) => {
    const target = orders.find((o) => o.id === orderId);
    onRetryMerchantWebhook(orderId);
    setActionNotice(
      `已按 [${
        target?.protocol ? PROTOCOL_META[target.protocol].shortName : '标准 JSON'
      }] 协议重新向 (${target?.notifyUrl || riskConfig.merchantCallbackUrl}) 投递签名回调`
    );
  };

  return (
    <div className="space-y-6">
      {/* DoloPay Email Approval Quick Action Queue */}
      {awaitingOrders.length > 0 && (
        <section
          aria-label="DoloPay 待管理员一键核销队列"
          className="bg-white border border-amber-300 rounded-xl p-5 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-amber-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-amber-950">
                DoloPay 邮件/机器人快捷审批待办队列 ({awaitingOrders.length} 笔买家已点击“我已支付”)
              </h2>
              <p className="text-xs text-amber-800 mt-0.5">
                当未开启手机端自动监听或网络延迟时，请核对手机支付宝/微信账单中的实付金额与 6 位备注口令后一键放行
              </p>
            </div>
            <span className="text-xs font-mono text-amber-800 shrink-0">
              管理员通知邮箱: {riskConfig.adminEmail}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {awaitingOrders.map((order) => (
              <div
                key={order.id}
                className="py-3 first:pt-1 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-mono font-bold text-slate-900">{order.id}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-medium text-slate-800">
                      {CHANNEL_META[order.channel].shortName}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-mono text-slate-600">口令 {order.remarkCode}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-slate-700 font-medium">
                      {order.payerNickName} ({order.payerEmail})
                    </span>
                    {order.appName && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-blue-700 font-medium">来源: {order.appName}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                    <span>留言：{order.payerMessage || '无留言'}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      审批路由: /dolopay/pass?id={order.id}&token={order.approvalToken.slice(0, 10)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-base font-bold font-mono tabular-nums text-amber-900">
                      ¥{centsToYuan(order.actualAmountCents)}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      原价 ¥{centsToYuan(order.nominalAmountCents)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerApprove(order.id, 'EMAIL_TOKEN_APPROVAL')}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <MailCheck className="w-3.5 h-3.5" />
                      确认收款通过
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerReject(order.id)}
                      className="px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-xs font-medium rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      驳回
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {actionNotice && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs flex items-center justify-between"
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-emerald-700 hover:underline font-medium ml-4 cursor-pointer"
          >
            知道了
          </button>
        </div>
      )}

      {/* Main Orders & Inspection Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: High-Density Order Ledger */}
        <section
          aria-label="全量收款订单与异常掉单台账"
          className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {[
                { key: 'ALL', label: `全部 (${orders.length})` },
                { key: 'PENDING_PAYMENT', label: '待支付' },
                { key: 'AWAITING_APPROVAL', label: '待核销' },
                { key: 'PAID', label: '已入账' },
                { key: 'EXPIRED', label: '超时掉单' },
                { key: 'REJECTED', label: '已驳回' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === tab.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="按接入应用筛选"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              >
                <option value="ALL">全部接入系统</option>
                {connectedApps.map((app) => (
                  <option key={app.id} value={app.appId}>
                    {app.name}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label="搜索订单号或外部透传参数"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜单号/外部单号/透传参数..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              当前筛选条件下暂无订单记录
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 whitespace-nowrap">
                    <th className="py-2.5 px-2">系统单号 · 外部单号</th>
                    <th className="py-2.5 px-2">来源应用 · 透传参数</th>
                    <th className="py-2.5 px-2">渠道</th>
                    <th className="py-2.5 px-2 text-right">原价 / 实付锁</th>
                    <th className="py-2.5 px-2">当前状态</th>
                    <th className="py-2.5 px-2 text-right">核销与运维操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOrders.map((order) => {
                    const isSelected = inspectedOrder?.id === order.id;
                    const st = STATUS_LABELS[order.status];
                    return (
                      <tr
                        key={order.id}
                        onClick={() => setInspectedOrderId(order.id)}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-2 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{order.id}</div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[145px]">
                            {order.outTradeNo} · {order.remarkCode}
                          </div>
                        </td>
                        <td className="py-3 px-2 max-w-[165px]">
                          <div className="font-medium text-slate-900 truncate">
                            {order.appName || '收银台直连'}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate">
                            {order.attach ? order.attach : order.productTitle}
                          </div>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <div className="font-medium text-slate-800">
                            {CHANNEL_META[order.channel].shortName}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {order.qrMatchType === 'FIXED_EXACT' ? '指定固码' : '通用码'}
                          </div>
                        </td>
                        <td className="py-3 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            ¥{centsToYuan(order.actualAmountCents)}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            原 ¥{centsToYuan(order.nominalAmountCents)}
                          </div>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <div className={st.textClass}>{st.label}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {order.protocol ? PROTOCOL_META[order.protocol].shortName : 'DoloPay REST v1'}
                          </div>
                        </td>
                        <td
                          className="py-3 px-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {(order.status === 'PENDING_PAYMENT' ||
                              order.status === 'AWAITING_APPROVAL') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => triggerApprove(order.id, 'EMAIL_TOKEN_APPROVAL')}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-md cursor-pointer"
                                >
                                  确认收款
                                </button>
                                <button
                                  type="button"
                                  onClick={() => triggerReject(order.id)}
                                  className="px-2 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-[11px] font-medium rounded-md cursor-pointer"
                                >
                                  驳回
                                </button>
                              </>
                            )}

                            {(order.status === 'EXPIRED' || order.status === 'REJECTED') && (
                              <button
                                type="button"
                                onClick={() => triggerApprove(order.id, 'MANUAL_RECONCILE')}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                掉单补单
                              </button>
                            )}

                            {order.status === 'PAID' && (
                              <button
                                type="button"
                                onClick={() => triggerRetryWebhook(order.id)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded-md inline-flex items-center gap-1 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                重发回调
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right 4 Cols: Multi-Protocol Webhook Envelope & Audit Inspector */}
        <section
          aria-label="订单核销凭证与跨系统回调报文详情"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">多协议回调报文与退避审计</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                根据接入系统协议自动封装 DoloPay REST / 彩虹易支付 / Stripe 签名载荷
              </p>
            </div>
            <FileCode2 className="w-4 h-4 text-slate-400" />
          </div>

          {inspectedOrder && webhookEnvelope ? (
            <div className="space-y-4 text-xs">
              <div className="space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">接入业务系统</span>
                  <span className="font-semibold text-slate-900">
                    {inspectedOrder.appName || '默认直连应用'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">适配回调协议</span>
                  <span className="font-mono text-blue-700 font-semibold">
                    {PROTOCOL_META[webhookEnvelope.protocol].shortName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">外部单号 / 透传</span>
                  <span className="font-mono text-slate-700 truncate max-w-[190px]">
                    {inspectedOrder.outTradeNo} ({inspectedOrder.attach || '无'})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">指数退避重试策略</span>
                  <span className="font-mono text-slate-700">
                    0s / 15s / 60s / 300s / 900s
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">最近响应状态</span>
                  <span className="font-mono text-emerald-700 truncate max-w-[190px]">
                    {inspectedOrder.webhookLastResponse || '待核销后触发投递'}
                  </span>
                </div>
              </div>

              {/* HTTP Request Headers */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-800">
                  回调请求头 (POST {webhookEnvelope.targetUrl})
                </div>
                <pre className="bg-slate-900 text-slate-100 font-mono text-[11px] p-3 rounded-lg overflow-x-auto leading-relaxed">
{Object.entries(webhookEnvelope.headers)
  .map(([k, v]) => `${k}: ${v}`)
  .join('\n')}
                </pre>
              </div>

              {/* Outgoing Merchant Callback Payload */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-800">
                  回调签名载荷 ({PROTOCOL_META[webhookEnvelope.protocol].shortName})
                </div>
                <pre className="bg-slate-900 text-slate-100 font-mono text-[11px] p-3 rounded-lg overflow-x-auto leading-relaxed">
{JSON.stringify(webhookEnvelope.body, null, 2)}
                </pre>
              </div>

              {/* DoloPay Admin Email Action Links */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-800">
                  DoloPay 邮件/飞书卡片免密审批路由
                </div>
                <div className="bg-slate-900 text-slate-100 font-mono text-[11px] p-3 rounded-lg space-y-1 overflow-x-auto">
                  <div className="text-emerald-400">
                    GET /dolopay/pass?id={inspectedOrder.id}&token={inspectedOrder.approvalToken}
                  </div>
                  <div className="text-rose-400">
                    GET /dolopay/back?id={inspectedOrder.id}&token={inspectedOrder.approvalToken}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

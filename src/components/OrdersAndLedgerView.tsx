/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { centsToYuan, type OrderStatus } from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import type { AdminOrderRecord, AdminStatePayload } from '../types/api';

interface OrdersAndLedgerViewProps {
  adminState: AdminStatePayload;
  onApproveOrder: (orderId: string) => Promise<void>;
  onRejectOrder: (orderId: string) => Promise<void>;
  onRetryWebhook: (orderId: string) => Promise<void>;
  onClearDemoOrders: () => Promise<void>;
  onOpenMobileApprovePreview: (orderId: string, token: string) => void;
  onRefresh: () => Promise<void>;
}

const STATUS_LABEL: Record<OrderStatus, { text: string; tone: string }> = {
  PENDING_PAYMENT: { text: '待扫码支付', tone: 'text-blue-700' },
  AWAITING_APPROVAL: { text: '已申报 · 待核销', tone: 'text-amber-700 font-semibold' },
  PAID: { text: '已核销入账', tone: 'text-emerald-700 font-semibold' },
  EXPIRED: { text: '已超时关闭', tone: 'text-slate-500' },
  REJECTED: { text: '已驳回', tone: 'text-rose-600 font-medium' },
};

const SETTLEMENT_LABEL: Record<string, string> = {
  APPROVAL_LINK: '签名确认页核销',
  MANUAL_ADMIN: '后台人工核销',
  ANDROID_WEBHOOK: '安卓监听自动核销',
};

export const OrdersAndLedgerView: React.FC<OrdersAndLedgerViewProps> = ({
  adminState,
  onApproveOrder,
  onRejectOrder,
  onRetryWebhook,
  onClearDemoOrders,
  onOpenMobileApprovePreview,
  onRefresh,
}) => {
  const { metrics, orders } = adminState;
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const awaitingOrders = orders.filter((o) => o.status === 'AWAITING_APPROVAL');
  const hasDemoOrders = orders.some((o) => o.isDemo);

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      o.outTradeNo.toLowerCase().includes(q) ||
      o.productTitle.toLowerCase().includes(q) ||
      o.payerNickName.toLowerCase().includes(q) ||
      o.payerEmail.toLowerCase().includes(q) ||
      o.remarkCode.includes(q)
    );
  });

  const handleAction = async (orderId: string, fn: () => Promise<void>, successText: string) => {
    setBusyId(orderId);
    setNotice(null);
    try {
      await fn();
      setNotice(successText);
    } finally {
      setBusyId(null);
    }
  };

  const formatSafeCsvCell = (raw: string | number | undefined | null): string => {
    const str = String(raw ?? '');
    const neutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${neutralized.replace(/"/g, '""')}"`;
  };

  const handleExportCsv = () => {
    const headers = [
      '订单号',
      '外部单号',
      '商品项目',
      '渠道',
      '实付金额(元)',
      '付款口令',
      '状态',
      '核销方式',
      '付款人',
      '邮箱',
      '创建时间',
    ];
    const rows = orders.map((o) => [
      formatSafeCsvCell(o.id),
      formatSafeCsvCell(o.outTradeNo),
      formatSafeCsvCell(o.productTitle),
      formatSafeCsvCell(CHANNEL_META[o.channel].shortName),
      formatSafeCsvCell(centsToYuan(o.actualAmountCents)),
      formatSafeCsvCell(o.remarkCode),
      formatSafeCsvCell(STATUS_LABEL[o.status].text),
      formatSafeCsvCell(
        o.settlementMethod ? SETTLEMENT_LABEL[o.settlementMethod] || o.settlementMethod : ''
      ),
      formatSafeCsvCell(o.payerNickName),
      formatSafeCsvCell(o.payerEmail),
      formatSafeCsvCell(new Date(o.createdAt).toISOString()),
    ]);
    const csv =
      '\uFEFF' +
      [headers.map(formatSafeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dolopay-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <section aria-label="核心收款统计" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">已核销收款净额（0% 手续费）</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              ¥{centsToYuan(metrics.paidGmvCents)}
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-700">
              {metrics.paidCount} 笔入账
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            支付宝 ¥{centsToYuan(metrics.channelStats.alipay.paidCents)} · 微信 ¥
            {centsToYuan(metrics.channelStats.wechat.paidCents)}
            {adminState.settings.plugins.unionpay
              ? ` · 云闪付 ¥${centsToYuan(metrics.channelStats.unionpay.paidCents)}`
              : ''}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">待管理员核销审批</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-amber-700">
              {metrics.pendingApprovalCount}
            </span>
            <span className="text-xs text-slate-500">笔已申报付款</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            支持手机端飞书 / 邮件 / 钉钉一键核销
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">当前待扫码订单</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.pendingPaymentCount}
            </span>
            <span className="text-xs text-slate-500">笔待付款</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            超时 {Math.round(adminState.settings.orderTtlSeconds / 60)} 分钟自动关闭
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">累计订单 · 核销转化率</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.totalOrdersCount}
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-600">
              转化 {metrics.conversionRatePercent}%
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">已超时过期 {metrics.expiredCount} 笔</div>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg"
        >
          {notice}
        </div>
      )}

      {/* Pending Approval Priority Queue */}
      {awaitingOrders.length > 0 && (
        <section
          aria-label="待核销审批队列"
          className="bg-white border border-amber-300 rounded-xl p-5 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-amber-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                待审批收款队列（{awaitingOrders.length} 笔买家已申报付款）
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                核对手机支付宝 / 微信实收金额与 6 位口令后直接放行，或点击「打开手机审批页」体验通知链接页面
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {awaitingOrders.map((order: AdminOrderRecord) => (
              <div
                key={order.id}
                className="py-3.5 first:pt-1 last:pb-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-mono font-bold text-slate-900">{order.id}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-medium text-slate-800">
                      {CHANNEL_META[order.channel].shortName}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-mono font-semibold text-blue-700">
                      口令 {order.remarkCode}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-slate-700">
                      {order.payerNickName}
                      {order.payerEmail ? ` (${order.payerEmail})` : ''}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {order.productTitle}
                    {order.payerMessage ? ` · 留言：${order.payerMessage}` : ''}
                  </div>
                  {order.notificationLogs.length > 0 && (
                    <div className="text-[11px] text-slate-500">
                      审批推送：
                      {order.notificationLogs
                        .slice(0, 3)
                        .map((l) => `${l.channelName}(${l.ok ? (l.skipped ? '待配置' : '已送达') : '失败'})`)
                        .join(' · ')}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 flex-wrap">
                  <div className="text-right mr-1">
                    <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                      ¥{centsToYuan(order.actualAmountCents)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenMobileApprovePreview(order.id, order.approvalToken)}
                    className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    手机确认页
                  </button>
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() =>
                      handleAction(
                        order.id,
                        () => onApproveOrder(order.id),
                        `订单 ${order.id} 已确认收款放行`
                      )
                    }
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    确认收款
                  </button>
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() =>
                      handleAction(order.id, () => onRejectOrder(order.id), `已驳回订单 ${order.id}`)
                    }
                    className="px-3 py-2 bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-600 border border-rose-200 text-xs font-medium rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    驳回
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full Order Ledger Table */}
      <section aria-label="全部订单明细" className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'ALL', label: '全部' },
                { id: 'AWAITING_APPROVAL', label: '待核销' },
                { id: 'PENDING_PAYMENT', label: '待支付' },
                { id: 'PAID', label: '已入账' },
                { id: 'EXPIRED', label: '已过期' },
                { id: 'REJECTED', label: '已驳回' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜订单号 / 口令 / 买家..."
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 w-52 focus:outline-none focus:border-blue-600"
              />
            </div>

            <button
              type="button"
              onClick={() => void onRefresh()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              导出 CSV
            </button>

            {hasDemoOrders && (
              <button
                type="button"
                onClick={() =>
                  handleAction('demo', onClearDemoOrders, '已清空演示订单，准备正式收款')
                }
                className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空演示订单
              </button>
            )}
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            当前筛选条件下暂无订单记录
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-medium">
                  <th className="py-2.5 pr-4">订单号 / 口令</th>
                  <th className="py-2.5 pr-4">项目与买家</th>
                  <th className="py-2.5 pr-4">渠道</th>
                  <th className="py-2.5 pr-4 text-right">金额</th>
                  <th className="py-2.5 pr-4">状态与核销方式</th>
                  <th className="py-2.5 pr-4">下游回调</th>
                  <th className="py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => {
                  const st = STATUS_LABEL[order.status];
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 pr-4 align-top">
                        <div className="font-mono font-semibold text-slate-900">{order.id}</div>
                        <div className="font-mono text-slate-500 mt-0.5">
                          口令 {order.remarkCode} ·{' '}
                          {new Date(order.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                        </div>
                      </td>
                      <td className="py-3 pr-4 align-top max-w-[240px]">
                        <div className="font-medium text-slate-900 truncate">{order.productTitle}</div>
                        <div className="text-slate-500 truncate mt-0.5">
                          {order.payerNickName}
                          {order.payerEmail ? ` · ${order.payerEmail}` : ''}
                        </div>
                      </td>
                      <td className="py-3 pr-4 align-top whitespace-nowrap text-slate-700">
                        {CHANNEL_META[order.channel].shortName}
                      </td>
                      <td className="py-3 pr-4 align-top text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        ¥{centsToYuan(order.actualAmountCents)}
                      </td>
                      <td className="py-3 pr-4 align-top whitespace-nowrap">
                        <div className={st.tone}>{st.text}</div>
                        {order.settlementMethod && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {SETTLEMENT_LABEL[order.settlementMethod] || order.settlementMethod}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 align-top max-w-[180px]">
                        <div className="text-slate-700">
                          {order.webhookStatus === 'DELIVERED'
                            ? '已送达'
                            : order.webhookStatus === 'FAILED'
                            ? '投递失败'
                            : order.webhookStatus === 'SKIPPED'
                            ? '未配置回调'
                            : '待触发'}
                        </div>
                        {order.webhookLastResponse && (
                          <div className="text-[11px] text-slate-400 truncate mt-0.5" title={order.webhookLastResponse}>
                            {order.webhookLastResponse}
                          </div>
                        )}
                      </td>
                      <td className="py-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2.5">
                          {(order.status === 'PENDING_PAYMENT' ||
                            order.status === 'AWAITING_APPROVAL' ||
                            order.status === 'EXPIRED') && (
                            <button
                              type="button"
                              disabled={busyId === order.id}
                              onClick={() =>
                                handleAction(
                                  order.id,
                                  () => onApproveOrder(order.id),
                                  `订单 ${order.id} 已人工核销放行`
                                )
                              }
                              className="text-emerald-700 font-medium hover:underline cursor-pointer"
                            >
                              {order.status === 'EXPIRED' ? '掉单补单' : '核销通过'}
                            </button>
                          )}
                          {order.status === 'PAID' && order.notifyUrl && (
                            <button
                              type="button"
                              disabled={busyId === order.id}
                              onClick={() =>
                                handleAction(
                                  order.id,
                                  () => onRetryWebhook(order.id),
                                  `已向 ${order.notifyUrl} 重发回调`
                                )
                              }
                              className="text-blue-600 font-medium hover:underline cursor-pointer"
                            >
                              重发回调
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenMobileApprovePreview(order.id, order.approvalToken)}
                            className="text-slate-500 hover:text-slate-900 hover:underline cursor-pointer"
                          >
                            审批页
                          </button>
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
    </div>
  );
};

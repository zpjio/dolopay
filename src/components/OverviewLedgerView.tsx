import React, { useState } from 'react';
import {
  Download,
  Search,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
} from 'lucide-react';
import {
  centsToYuan,
  type DashboardMetrics,
  type PaymentChannel,
  type DoloPayOrder,
} from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';

interface OverviewLedgerViewProps {
  metrics: DashboardMetrics;
  orders: DoloPayOrder[];
  onNavigateToOrders: (statusFilter?: string) => void;
  onNavigateToCashier: (orderId?: string) => void;
}

export const OverviewLedgerView: React.FC<OverviewLedgerViewProps> = ({
  metrics,
  orders,
  onNavigateToOrders,
  onNavigateToCashier,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | PaymentChannel>('all');

  const paidOrders = orders.filter((o) => o.status === 'PAID');
  const filteredPaidOrders = paidOrders.filter((o) => {
    if (channelFilter !== 'all' && o.channel !== channelFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      o.payerNickName.toLowerCase().includes(q) ||
      o.productTitle.toLowerCase().includes(q) ||
      o.remarkCode.includes(q)
    );
  });

  const handleExportCsv = () => {
    const headers = ['订单号', '外部单号', '项目名称', '收款渠道', '标称金额(元)', '实付金额(元)', '付款人', '核销方式', '支付时间'];
    const rows = paidOrders.map((o) => [
      o.id,
      o.outTradeNo,
      `"${o.productTitle.replace(/"/g, '""')}"`,
      CHANNEL_META[o.channel].shortName,
      centsToYuan(o.nominalAmountCents),
      centsToYuan(o.actualAmountCents),
      `"${o.payerNickName.replace(/"/g, '""')}"`,
      o.settlementMethod || 'AUTO_WEBHOOK',
      o.paidAt ? new Date(o.paidAt).toISOString() : '',
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dolopay-reconcile-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalGmv = Math.max(1, metrics.todayPaidGmvCents);

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <section aria-label="核心收款与对账指标" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>已核销收款净额 (0手续费直达)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              ¥{centsToYuan(metrics.todayPaidGmvCents)}
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-600">
              {metrics.todayPaidCount} 笔入账
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            资金100%直入个人支付宝/微信/银联账户
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>当前并发占用金额锁</span>
            <Lock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.activeLocksCount}
            </span>
            <span className="text-xs text-slate-500">个唯一分位槽</span>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onNavigateToCashier()}
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              前往收银台查看占用矩阵
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>待管理员邮件/后台核销</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.pendingApprovalCount}
            </span>
            <span className="text-xs text-amber-700">笔买家已申报付款</span>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onNavigateToOrders('AWAITING_APPROVAL')}
              className="text-xs text-amber-700 hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              立即处理一键核销
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>订单核销转化率 · 异常掉单</span>
            <AlertCircle className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.conversionRatePercent}%
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              超时未付 {metrics.expiredCount} 笔
            </span>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onNavigateToOrders('EXPIRED')}
              className="text-xs text-slate-600 hover:text-slate-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              排查超时掉单并补单
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </section>

      {/* Channel Breakdown + Settlement Architecture Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          aria-label="三网个人收款码渠道份额"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">三网收款码渠道清算分布</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                按实付核销金额统计各渠道占比与当前并发锁负载
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              总计 {metrics.todayPaidCount} 笔已结算
            </span>
          </div>

          <div className="space-y-4">
            {(['alipay', 'wechat', 'unionpay'] as PaymentChannel[]).map((ch) => {
              const stat = metrics.channelStats[ch];
              const pct = Math.round((stat.paidCents / totalGmv) * 100);
              return (
                <div key={ch} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{CHANNEL_META[ch].name}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        已核销 {stat.paidCount} 笔
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono tabular-nums text-blue-600">
                        当前锁定 {stat.activeLocks} 槽位
                      </span>
                    </div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900">
                      ¥{centsToYuan(stat.paidCents)} ({pct}%)
                    </div>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${CHANNEL_META[ch].accentBg} transition-all`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section
          aria-label="DoloPay 高可用防掉单保障机制"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">个人收款高可用防掉单四重保障</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              针对个人码无官方异步网关的工程级容错方案
            </p>
          </div>

          <div className="space-y-3 text-xs text-slate-600">
            <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-100">
              <div>
                <div className="font-semibold text-slate-900">1. 整数分位原子锁 (Zero-Float Drift)</div>
                <p className="text-slate-500 mt-0.5">
                  全链路采用整数分 (Cents) 运算，彻底杜绝 IEEE 754 浮点数精度偏移导致的对账失败。
                </p>
              </div>
              <span className="font-mono text-emerald-700 shrink-0">已启用</span>
            </div>

            <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-100">
              <div>
                <div className="font-semibold text-slate-900">2. 高频金额固码池免输匹配</div>
                <p className="text-slate-500 mt-0.5">
                  优先下发对应实付金额的指定金额固码，防止买家手动少输 0.01 元造成掉单。
                </p>
              </div>
              <span className="font-mono text-emerald-700 shrink-0">已启用</span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">3. App 监听 + 邮件/机器人双轨兜底</div>
                <p className="text-slate-500 mt-0.5">
                  移动端监听断网时，买家点击“我已支付”即刻触发带签名 Token 的管理员一键核销通知。
                </p>
              </div>
              <span className="font-mono text-emerald-700 shrink-0">双活运行</span>
            </div>
          </div>
        </section>
      </div>

      {/* Public Payer / Reconciliation Ledger Table */}
      <section
        aria-label="已核销对账单与公开收款榜"
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">已核销资金对账单 (DoloPay 公开核销榜)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              实时记录每一笔已验证入账的个人收款码流水、实付分位差额与核销凭证
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Interactive Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'alipay', 'wechat', 'unionpay'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    channelFilter === ch
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ch === 'all' ? '全部渠道' : CHANNEL_META[ch].shortName}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="搜索已核销账单"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜单号/昵称/口令..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
              />
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              导出对账 CSV
            </button>
          </div>
        </div>

        {filteredPaidOrders.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">暂无符合筛选条件的已核销账单</p>
            <p className="text-xs text-slate-500">可在收银台发起测试收款并执行回调核销</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 px-3">系统单号</th>
                  <th className="py-2.5 px-3">收款项目 / 留言</th>
                  <th className="py-2.5 px-3">付款人</th>
                  <th className="py-2.5 px-3">渠道 · 码类型</th>
                  <th className="py-2.5 px-3 text-right">标称原价</th>
                  <th className="py-2.5 px-3 text-right">实付核销金额</th>
                  <th className="py-2.5 px-3">核销通道与流水凭证</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPaidOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                      <div>{order.id}</div>
                      <div className="text-[11px] text-slate-400">口令 {order.remarkCode}</div>
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <div className="font-medium text-slate-900 truncate">{order.productTitle}</div>
                      <div className="text-slate-500 truncate mt-0.5">{order.payerMessage || '—'}</div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{order.payerNickName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{order.payerEmail}</div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-slate-600">
                      <span className="font-medium text-slate-900">
                        {CHANNEL_META[order.channel].shortName}
                      </span>
                      <span aria-hidden="true" className="mx-1 text-slate-300">·</span>
                      <span>{order.qrMatchType === 'FIXED_EXACT' ? '固码免输' : '通用动态码'}</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      ¥{centsToYuan(order.nominalAmountCents)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      ¥{centsToYuan(order.actualAmountCents)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-slate-600">
                      <div>
                        {order.settlementMethod === 'AUTO_WEBHOOK'
                          ? 'App监听自动回调'
                          : order.settlementMethod === 'EMAIL_TOKEN_APPROVAL'
                          ? 'DoloPay邮件一键核销'
                          : '异常掉单人工补单'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate max-w-[180px]">
                        {order.deviceTransactionId || `Token:${order.approvalToken.slice(0, 10)}`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

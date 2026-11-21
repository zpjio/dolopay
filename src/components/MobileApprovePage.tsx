/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import type { PaymentChannel, OrderStatus } from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';

interface InspectedApprovalOrder {
  orderId: string;
  outTradeNo: string;
  productTitle: string;
  channel: PaymentChannel;
  nominalAmountYuan: string;
  actualAmountYuan: string;
  remarkCode: string;
  payerNickName: string;
  payerEmail: string;
  payerMessage: string;
  status: OrderStatus;
  createdAt: number;
  paidAt: number | null;
  rejectedAt: number | null;
}

interface MobileApprovePageProps {
  orderId: string;
  token: string;
  onExitToHome: () => void;
}

export const MobileApprovePage: React.FC<MobileApprovePageProps> = ({
  orderId,
  token,
  onExitToHome,
}) => {
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'reject' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<InspectedApprovalOrder | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    fetch(
      `/api/v1/approve/inspect?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(
        token
      )}`
    )
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok || body.code !== 0) {
          setErrorMsg(body.msg || '审批链接无效或已过期');
          return;
        }
        setOrder(body.data);
      })
      .catch(() => {
        if (!cancelled) setErrorMsg('无法连接服务端校验审批令牌');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, token]);

  const handleDecide = async (action: 'approve' | 'reject') => {
    setSubmittingAction(action);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/v1/approve/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, token, action }),
      });
      const body = await resp.json();
      if (!resp.ok || body.code !== 0) {
        setErrorMsg(body.msg || '操作未能完成');
        return;
      }
      setResultMsg(body.msg);
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              status: body.data?.status || (action === 'approve' ? 'PAID' : 'REJECTED'),
              paidAt: body.data?.paidAt || prev.paidAt,
            }
          : prev
      );
    } catch {
      setErrorMsg('网络请求异常，请重试');
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-900" />
            <span className="text-base font-bold text-slate-900">DoloPay 快捷收款核销</span>
          </div>
          <button
            type="button"
            onClick={onExitToHome}
            className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            返回主站
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            <span>正在验证审批链接签名...</span>
          </div>
        ) : errorMsg && !order ? (
          <div className="py-8 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-rose-600 mx-auto" />
            <h1 className="text-base font-bold text-slate-900">审批链接校验失败</h1>
            <p className="text-xs text-slate-600">{errorMsg}</p>
          </div>
        ) : order ? (
          <>
            {/* Amount & Remark Hero */}
            <div className="text-center py-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <div className="text-xs text-slate-500">
                {CHANNEL_META[order.channel].shortName} · 请核对手机账单实收金额
              </div>
              <div className="text-4xl font-bold font-mono tabular-nums text-slate-900">
                ¥{order.actualAmountYuan}
              </div>
              <div className="text-xs text-slate-600">
                6 位付款口令：
                <span className="font-mono font-bold text-blue-700 text-sm tracking-wider ml-1">
                  {order.remarkCode}
                </span>
              </div>
            </div>

            {/* Order Details */}
            <dl className="divide-y divide-slate-100 text-xs">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">商品项目</dt>
                <dd className="text-slate-900 font-medium text-right">{order.productTitle}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">订单编号</dt>
                <dd className="font-mono text-slate-800 text-right">{order.orderId}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">付款人</dt>
                <dd className="text-slate-800 text-right">
                  {order.payerNickName}
                  {order.payerEmail ? ` (${order.payerEmail})` : ''}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">买家留言</dt>
                <dd className="text-slate-700 text-right">{order.payerMessage || '无'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">下单时间</dt>
                <dd className="font-mono tabular-nums text-slate-600 text-right">
                  {new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </dd>
              </div>
            </dl>

            {errorMsg && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                {errorMsg}
              </div>
            )}

            {order.status === 'PAID' ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-1.5">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <div className="text-sm font-bold text-emerald-900">该订单已核销放行</div>
                <p className="text-xs text-emerald-800">
                  {resultMsg || '买家端已收到成功状态，如有下游业务回调也已自动投递。'}
                </p>
              </div>
            ) : order.status === 'REJECTED' ? (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-1.5">
                <XCircle className="w-7 h-7 text-rose-600 mx-auto" />
                <div className="text-sm font-bold text-rose-900">该笔申报已被驳回</div>
                <p className="text-xs text-rose-800">{resultMsg || '订单已标记为未收款驳回。'}</p>
              </div>
            ) : (
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  disabled={submittingAction !== null}
                  onClick={() => handleDecide('approve')}
                  className="w-full min-h-[48px] px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {submittingAction === 'approve' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  确认已收到 ¥{order.actualAmountYuan}，放行订单
                </button>
                <button
                  type="button"
                  disabled={submittingAction !== null}
                  onClick={() => handleDecide('reject')}
                  className="w-full min-h-[44px] px-4 py-2.5 bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-600 border border-rose-200 text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {submittingAction === 'reject' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  未收到款，驳回申报
                </button>
                <p className="text-[11px] text-slate-400 text-center">
                  本页采用 GET 只读验签 + POST 确认机制，防止邮件或聊天客户端自动预加载误核销
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};

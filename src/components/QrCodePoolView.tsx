/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Power,
  QrCode,
  CheckCircle2,
} from 'lucide-react';
import {
  centsToYuan,
  yuanToCents,
  type PaymentChannel,
  type QrCodeItem,
} from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import { QrCodeMatrixSvg } from './QrCodeMatrixSvg';

interface QrCodePoolViewProps {
  qrPool: QrCodeItem[];
  onAddQrCode: (item: Omit<QrCodeItem, 'id' | 'todayCount' | 'todayAmountCents' | 'createdAt'>) => void;
  onToggleQrCode: (id: string) => void;
  onDeleteQrCode: (id: string) => void;
}

export const QrCodePoolView: React.FC<QrCodePoolViewProps> = ({
  qrPool,
  onAddQrCode,
  onToggleQrCode,
  onDeleteQrCode,
}) => {
  const [channelFilter, setChannelFilter] = useState<'all' | PaymentChannel>('all');
  const [newChannel, setNewChannel] = useState<PaymentChannel>('alipay');
  const [newType, setNewType] = useState<'FIXED' | 'UNIVERSAL'>('FIXED');
  const [newFixedYuan, setNewFixedYuan] = useState('10.02');
  const [newLabel, setNewLabel] = useState('支付宝 ¥10.02 并发浮动固码 #2');
  const [newAccountMask, setNewAccountMask] = useState('138****6920 (*明)');
  const [newPayloadUrl, setNewPayloadUrl] = useState('https://qr.alipay.com/fkx1002fixed2026');
  const [formMsg, setFormMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const filteredPool = qrPool.filter((q) =>
    channelFilter === 'all' ? true : q.channel === channelFilter
  );

  const handleCreateQr = (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);

    if (!newLabel.trim() || !newPayloadUrl.trim()) {
      setFormMsg({ type: 'error', text: '请填写完整的收款码名称与二维码解析内容链接' });
      return;
    }

    let fixedCents: number | undefined;
    if (newType === 'FIXED') {
      const parsed = yuanToCents(newFixedYuan);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setFormMsg({ type: 'error', text: '请输入有效的指定固码金额（如 10.02）' });
        return;
      }
      fixedCents = parsed;
    }

    onAddQrCode({
      channel: newChannel,
      type: newType,
      fixedAmountCents: fixedCents,
      label: newLabel.trim(),
      accountMask: newAccountMask.trim() || '未命名收款号',
      qrPayloadUrl: newPayloadUrl.trim(),
      enabled: true,
    });

    setFormMsg({
      type: 'success',
      text:
        newType === 'FIXED' && fixedCents
          ? `已成功入库 ${CHANNEL_META[newChannel].shortName} ¥${centsToYuan(fixedCents)} 指定金额固码！当订单实付金额匹配该值时将自动免输金额。`
          : `已成功入库 ${CHANNEL_META[newChannel].shortName} 通用收款码！`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 4 Cols: Add QR Code Form */}
        <section
          aria-label="录入新个人收款码或固码"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">新增个人收款码 / 固码池</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              建议为高频商品金额（如 10.00、10.01、10.02）预传指定金额固码，客户扫码无需手输分位
            </p>
          </div>

          <form onSubmit={handleCreateQr} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="qr-channel-select" className="block text-xs font-medium text-slate-700 mb-1">
                  所属收款渠道
                </label>
                <select
                  id="qr-channel-select"
                  value={newChannel}
                  onChange={(e) => {
                    const ch = e.target.value as PaymentChannel;
                    setNewChannel(ch);
                    if (ch === 'alipay') setNewPayloadUrl('https://qr.alipay.com/fkx1002fixed2026');
                    if (ch === 'wechat') setNewPayloadUrl('wxp://f2f0dolopay1002fixed');
                    if (ch === 'unionpay') setNewPayloadUrl('https://qr.95516.com/00010000/1002');
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
                >
                  <option value="alipay">支付宝收款码</option>
                  <option value="wechat">微信个人收款码</option>
                  <option value="unionpay">云闪付收款码</option>
                </select>
              </div>

              <div>
                <label htmlFor="qr-type-select" className="block text-xs font-medium text-slate-700 mb-1">
                  收款码类型
                </label>
                <select
                  id="qr-type-select"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as 'FIXED' | 'UNIVERSAL')}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
                >
                  <option value="FIXED">指定金额固码 (免手输)</option>
                  <option value="UNIVERSAL">通用任意金额码 (兜底)</option>
                </select>
              </div>
            </div>

            {newType === 'FIXED' && (
              <div>
                <label htmlFor="qr-fixed-amount-input" className="block text-xs font-medium text-slate-700 mb-1">
                  固码绑定实付金额 (元)
                </label>
                <input
                  id="qr-fixed-amount-input"
                  type="text"
                  value={newFixedYuan}
                  onChange={(e) => {
                    setNewFixedYuan(e.target.value);
                    setNewLabel(`${CHANNEL_META[newChannel].shortName} ¥${e.target.value} 并发浮动固码`);
                  }}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="10.02"
                />
              </div>
            )}

            <div>
              <label htmlFor="qr-label-input" className="block text-xs font-medium text-slate-700 mb-1">
                收款码备注名称
              </label>
              <input
                id="qr-label-input"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="qr-account-input" className="block text-xs font-medium text-slate-700 mb-1">
                收款实名脱敏标识
              </label>
              <input
                id="qr-account-input"
                type="text"
                value={newAccountMask}
                onChange={(e) => setNewAccountMask(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
              />
            </div>

            <div>
              <label htmlFor="qr-url-input" className="block text-xs font-medium text-slate-700 mb-1">
                二维码解码原始 URI (无需上传图片被压缩，支持直接重绘矢量码)
              </label>
              <input
                id="qr-url-input"
                type="text"
                value={newPayloadUrl}
                onChange={(e) => setNewPayloadUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700"
              />
            </div>

            {formMsg && (
              <div
                role="status"
                className={`p-3 rounded-lg text-xs border ${
                  formMsg.type === 'error'
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {formMsg.text}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              保存并加入收款码池
            </button>
          </form>
        </section>

        {/* Right 8 Cols: Active QR Code Matrix List */}
        <section
          aria-label="已配置的个人收款码与固码矩阵"
          className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                收款码矩阵池 ({filteredPool.length} 个收款码)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                系统调度优先级：优先精确匹配同渠道【指定金额固码】 → 未命中时自动回退至【通用任意金额码】
              </p>
            </div>

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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredPool.map((item) => (
              <div
                key={item.id}
                className={`border rounded-xl p-4 flex items-start gap-4 transition-colors ${
                  item.enabled
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-50 border-slate-200 opacity-60'
                }`}
              >
                <QrCodeMatrixSvg
                  payload={item.qrPayloadUrl}
                  channel={item.channel}
                  size={88}
                  expired={!item.enabled}
                />

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {item.label}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {item.type === 'FIXED' && item.fixedAmountCents
                        ? `固码 ¥${centsToYuan(item.fixedAmountCents)}`
                        : '通用收款码'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span>{CHANNEL_META[item.channel].shortName}</span>
                    <span aria-hidden="true">·</span>
                    <span>账号 {item.accountMask}</span>
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    URI: {item.qrPayloadUrl}
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-slate-100 text-xs">
                    <span className="font-mono tabular-nums text-slate-600">
                      今日收款 {item.todayCount} 笔 · ¥{centsToYuan(item.todayAmountCents)}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleQrCode(item.id)}
                        className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        {item.enabled ? '停用' : '启用'}
                      </button>
                      {item.type === 'FIXED' && (
                        <button
                          type="button"
                          onClick={() => onDeleteQrCode(item.id)}
                          aria-label={`删除 ${item.label}`}
                          className="text-rose-600 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

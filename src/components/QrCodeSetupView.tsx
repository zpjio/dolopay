/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { FolderOpen, ImageOff, Loader2, QrCode, Save, Trash2, Upload } from 'lucide-react';
import type { PaymentChannel } from '../core/dolopayEngine';
import { CHANNEL_META } from '../core/seedData';
import type { AdminStatePayload, QrSlotWithImage } from '../types/api';

function buildSampleQrPngDataUrl(channel: PaymentChannel): string {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const colorMap: Record<PaymentChannel, string> = {
    alipay: '#1677ff',
    wechat: '#07c160',
    unionpay: '#e11d48',
  };
  const brandColor = colorMap[channel];

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 320, 320);

  ctx.strokeStyle = brandColor;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 292, 292);

  // Draw deterministic QR-like finder patterns
  const drawFinder = (x: number, y: number) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, y, 56, 56);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 8, y + 8, 40, 40);
    ctx.fillStyle = brandColor;
    ctx.fillRect(x + 16, y + 16, 24, 24);
  };
  drawFinder(36, 36);
  drawFinder(228, 36);
  drawFinder(36, 228);

  // Draw center matrix cells
  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const inTopLeft = r < 5 && c < 5;
      const inTopRight = r < 5 && c > 9;
      const inBottomLeft = r > 9 && c < 5;
      if (inTopLeft || inTopRight || inBottomLeft) continue;
      if (((r * 17 + c * 31 + channel.length * 7) % 3) !== 0) {
        ctx.fillRect(40 + c * 16, 40 + r * 16, 12, 12);
      }
    }
  }

  // Center badge
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(112, 134, 96, 52);
  ctx.strokeStyle = brandColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(112, 134, 96, 52);
  ctx.fillStyle = brandColor;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(CHANNEL_META[channel].shortName, 160, 157);
  ctx.fillStyle = '#475569';
  ctx.font = '11px sans-serif';
  ctx.fillText('演示测试收款码', 160, 175);

  return canvas.toDataURL('image/png');
}

interface QrCodeSetupViewProps {
  adminState: AdminStatePayload;
  onUploadQrImage: (channel: PaymentChannel, dataUrl: string) => Promise<{ ok: boolean; msg: string }>;
  onDeleteQrImage: (channel: PaymentChannel) => Promise<{ ok: boolean; msg: string }>;
  onUpdateQrMeta: (
    channel: PaymentChannel,
    patch: { enabled?: boolean; displayName?: string; accountMask?: string; paymentTip?: string }
  ) => Promise<{ ok: boolean; msg: string }>;
  onNavigateToPlugins: () => void;
}

export const QrCodeSetupView: React.FC<QrCodeSetupViewProps> = ({
  adminState,
  onUploadQrImage,
  onDeleteQrImage,
  onUpdateQrMeta,
  onNavigateToPlugins,
}) => {
  const visibleChannels: PaymentChannel[] = adminState.settings.plugins.unionpay
    ? ['alipay', 'wechat', 'unionpay']
    : ['alipay', 'wechat'];

  return (
    <div className="space-y-6">
      {/* Header + Out-of-the-Box Guidance */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-base font-bold text-slate-900">个人收款码配置（支持原图直传 / 目录替换）</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            两种零门槛方式任选其一：① 直接在下方上传您从支付宝/微信导出的原图（实时持久化保存）；② 或部署时直接把图片放进项目根目录的{' '}
            <span className="font-mono text-slate-900">public/qrcodes/alipay.png</span> 与{' '}
            <span className="font-mono text-slate-900">public/qrcodes/wechat.png</span>。
          </p>
        </div>
        {!adminState.settings.plugins.unionpay && (
          <button
            type="button"
            onClick={onNavigateToPlugins}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            需要云闪付？去扩展中心开启
          </button>
        )}
      </section>

      {/* Channel Cards Grid */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          visibleChannels.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        {visibleChannels.map((ch) => (
          <QrChannelCard
            key={ch}
            slot={adminState.qrSlots[ch]}
            onUploadQrImage={onUploadQrImage}
            onDeleteQrImage={onDeleteQrImage}
            onUpdateQrMeta={onUpdateQrMeta}
          />
        ))}
      </div>
    </div>
  );
};

interface QrChannelCardProps {
  slot: QrSlotWithImage;
  onUploadQrImage: (channel: PaymentChannel, dataUrl: string) => Promise<{ ok: boolean; msg: string }>;
  onDeleteQrImage: (channel: PaymentChannel) => Promise<{ ok: boolean; msg: string }>;
  onUpdateQrMeta: (
    channel: PaymentChannel,
    patch: { enabled?: boolean; displayName?: string; accountMask?: string; paymentTip?: string }
  ) => Promise<{ ok: boolean; msg: string }>;
}

const QrChannelCard: React.FC<QrChannelCardProps> = ({
  slot,
  onUploadQrImage,
  onDeleteQrImage,
  onUpdateQrMeta,
}) => {
  const meta = CHANNEL_META[slot.channel];
  const [enabled, setEnabled] = useState(slot.enabled);
  const [accountMask, setAccountMask] = useState(slot.accountMask);
  const [paymentTip, setPaymentTip] = useState(slot.paymentTip);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setEnabled(slot.enabled);
    setAccountMask(slot.accountMask);
    setPaymentTip(slot.paymentTip);
  }, [slot.enabled, slot.accountMask, slot.paymentTip]);

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFeedback({ ok: false, text: '仅支持 PNG、JPG 或 WebP 格式图片' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFeedback({ ok: false, text: '图片大小不能超过 2MB' });
      return;
    }
    setUploading(true);
    setFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const res = await onUploadQrImage(slot.channel, dataUrl);
      setFeedback({ ok: res.ok, text: res.msg });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : '上传失败' });
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateSampleQr = async () => {
    const dataUrl = buildSampleQrPngDataUrl(slot.channel);
    if (!dataUrl) return;
    setUploading(true);
    setFeedback(null);
    try {
      const res = await onUploadQrImage(slot.channel, dataUrl);
      setFeedback({
        ok: res.ok,
        text: res.ok ? `已生成 ${meta.shortName} 本地体验测试码（正式上线前请替换为真实收款码）` : res.msg,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await onUpdateQrMeta(slot.channel, {
        enabled,
        accountMask,
        paymentTip,
      });
      setFeedback({ ok: res.ok, text: res.msg });
    } finally {
      setSaving(false);
    }
  };

  const handleResetUploaded = async () => {
    setUploading(true);
    setFeedback(null);
    try {
      const res = await onDeleteQrImage(slot.channel);
      setFeedback({ ok: res.ok, text: res.msg });
    } finally {
      setUploading(false);
    }
  };

  const sourceLabel =
    slot.imageSource === 'uploaded'
      ? '后台已上传原图 (.data/qrcodes)'
      : slot.imageSource === 'static'
      ? `本地静态目录 (${meta.staticFileHint})`
      : '尚未配置收款码图片';

  return (
    <section
      aria-label={meta.name}
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
    >
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-slate-900">{meta.name}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{sourceLabel}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              const next = e.target.checked;
              setEnabled(next);
              void onUpdateQrMeta(slot.channel, { enabled: next });
            }}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          收银台启用
        </label>
      </div>

      {/* Image Preview + Upload Action */}
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="w-40 h-40 shrink-0 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden p-2">
          {slot.hasImage && slot.imageUrl ? (
            <img
              src={slot.imageUrl}
              alt={`${meta.shortName}个人收款码`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain bg-white rounded-lg"
            />
          ) : (
            <div className="text-center px-2 text-slate-400">
              <ImageOff className="w-6 h-6 mx-auto mb-1.5" />
              <div className="text-[11px] font-medium text-slate-600">暂无收款码</div>
            </div>
          )}
        </div>

        <div className="flex-1 w-full space-y-2">
          <label className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {slot.hasImage ? '重新上传收款码原图' : '上传个人收款码原图'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                void handleFileChange(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>

          {!slot.hasImage && (
            <button
              type="button"
              disabled={uploading}
              onClick={handleGenerateSampleQr}
              className="w-full py-2 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5 text-slate-500" />
              一键生成体验样张码（本地联调用）
            </button>
          )}

          {slot.imageSource === 'uploaded' && (
            <button
              type="button"
              disabled={uploading}
              onClick={handleResetUploaded}
              className="w-full py-2 px-3 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清除上传图（回退读取本地目录）
            </button>
          )}

          <div className="text-[11px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
            <FolderOpen className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              静态路径：<span className="font-mono text-slate-700">{meta.staticFileHint}</span>
              （支持 PNG/JPG/WebP，≤ 2MB）
            </span>
          </div>
        </div>
      </div>

      {/* Receiver Metadata Form */}
      <form onSubmit={handleSaveMeta} className="space-y-3 pt-2 border-t border-slate-100">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            收款实名脱敏提示（展示在二维码下方）
          </label>
          <input
            type="text"
            value={accountMask}
            onChange={(e) => setAccountMask(e.target.value)}
            placeholder="例如：张*明 (138****6920)"
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">买家付款提示语</label>
          <input
            type="text"
            value={paymentTip}
            onChange={(e) => setPaymentTip(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
          />
        </div>

        {feedback && (
          <div
            role="status"
            className={`p-2.5 rounded-lg text-xs border ${
              feedback.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          保存文案设置
        </button>
      </form>
    </section>
  );
};

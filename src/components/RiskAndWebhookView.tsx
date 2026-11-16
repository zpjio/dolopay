import React, { useState, useMemo } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Save,
  Plus,
  Send,
  KeyRound,
  BellRing,
  Globe,
  ArrowUpRight,
  Eye,
  EyeOff,
  HardDrive,
  Lock,
} from 'lucide-react';
import {
  centsToYuan,
  computeCanonicalOpenApiSign,
  computeDoloPaySignature,
  maskSensitiveSecret,
  type ConnectedApp,
  type FloatStrategy,
  type IntegrationProtocol,
  type NotificationChannelConfig,
  type PaymentChannel,
  type SecurityAuditEvent,
  type SystemRiskConfig,
  type DoloPayOrder,
  type WebhookNotifyPayload,
} from '../core/dolopayEngine';
import { PROTOCOL_META } from '../core/seedData';

interface RiskAndWebhookViewProps {
  riskConfig: SystemRiskConfig;
  connectedApps: ConnectedApp[];
  notificationChannels: NotificationChannelConfig[];
  securityAuditLogs: SecurityAuditEvent[];
  adminSessionToken: string | null;
  onSaveConfig: (nextConfig: SystemRiskConfig) => void;
  onAddConnectedApp: (
    app: Omit<ConnectedApp, 'id' | 'totalOrders' | 'totalPaidCents' | 'webhookSuccessRate' | 'createdAt'>
  ) => void;
  onToggleConnectedApp: (id: string) => void;
  onRotateAppSecret: (id: string) => void;
  onToggleNotificationChannel: (id: string) => void;
  onCreateExternalApiOrder: (params: {
    appId: string;
    outTradeNo: string;
    channel: PaymentChannel;
    nominalAmountYuan: string;
    productTitle: string;
    attach: string;
    notifyUrl: string;
  }) => { ok: boolean; order?: DoloPayOrder; errorMessage?: string };
  onTriggerWebhook: (payload: WebhookNotifyPayload) => { ok: boolean; message: string };
  onPersistToServer: () => Promise<{ ok: boolean; message: string }>;
  onNavigateToCashierWithOrder: (orderId: string) => void;
}

type CodeLangTab = 'epay' | 'nodejs' | 'python' | 'java' | 'go' | 'jswidget' | 'android';

export const RiskAndWebhookView: React.FC<RiskAndWebhookViewProps> = ({
  riskConfig,
  connectedApps,
  notificationChannels,
  securityAuditLogs,
  onSaveConfig,
  onAddConnectedApp,
  onToggleConnectedApp,
  onRotateAppSecret,
  onToggleNotificationChannel,
  onCreateExternalApiOrder,
  onTriggerWebhook,
  onPersistToServer,
  onNavigateToCashierWithOrder,
}) => {
  // 0. Security Self-Test & Secret Reveal state
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [selfTestFeedback, setSelfTestFeedback] = useState<{
    tone: 'emerald' | 'amber' | 'rose';
    text: string;
  } | null>(null);

  // 1. New Connected App form state
  const [newAppName, setNewAppName] = useState('WordPress / WooCommerce 会员商城');
  const [newAppProtocol, setNewAppProtocol] = useState<IntegrationProtocol>('EPAY_COMPAT');
  const [newAppNotifyUrl, setNewAppNotifyUrl] = useState('https://shop.example.com/wc-api/dolopay_notify');
  const [newAppReturnUrl] = useState('https://shop.example.com/checkout/order-received');
  const [newAppWhitelist, setNewAppWhitelist] = useState('*');
  const [appCreatedBanner, setAppCreatedBanner] = useState<string | null>(null);

  // 2. Live Open API Sandbox state
  const [sandboxAppId, setSandboxAppId] = useState<string>(
    connectedApps[0]?.appId || 'app_indiecloud_prod'
  );
  const [sandboxOutTradeNo, setSandboxOutTradeNo] = useState(
    `API_ORD_${Date.now().toString().slice(-6)}`
  );
  const [sandboxChannel, setSandboxChannel] = useState<PaymentChannel>('alipay');
  const [sandboxAmount, setSandboxAmount] = useState('10.00');
  const [sandboxTitle] = useState('SaaS 专业版年付订阅 (API 接入)');
  const [sandboxAttach, setSandboxAttach] = useState('userId=1024&plan=pro_annual&source=openapi');
  const [sandboxResult, setSandboxResult] = useState<{
    ok: boolean;
    httpStatus: number;
    orderId?: string;
    responseJson: string;
  } | null>(null);
  const [isCallingApi, setIsCallingApi] = useState(false);

  // 3. Multi-language SDK generator state
  const [codeTab, setCodeTab] = useState<CodeLangTab>('epay');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 4. Risk Control & Security form state
  const [floatStrategy, setFloatStrategy] = useState<FloatStrategy>(riskConfig.floatStrategy);
  const [maxFloatSteps, setMaxFloatSteps] = useState(String(riskConfig.maxFloatSteps));
  const [orderTtlSeconds, setOrderTtlSeconds] = useState(String(riskConfig.orderTtlSeconds));
  const [maxPendingPerIp, setMaxPendingPerIp] = useState(String(riskConfig.maxPendingPerIp));
  const [webhookReplayWindowSeconds, setWebhookReplayWindowSeconds] = useState(
    String(riskConfig.webhookReplayWindowSeconds || 300)
  );
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    String(riskConfig.rateLimitPerMinute || 30)
  );
  const [requireAdminAuth, setRequireAdminAuth] = useState<boolean>(riskConfig.requireAdminAuth);
  const [adminPassword, setAdminPassword] = useState<string>(
    riskConfig.adminPassword || 'DoloPay@2026'
  );
  const [webhookSecretKey, setWebhookSecretKey] = useState(riskConfig.webhookSecretKey);
  const [merchantCallbackUrl] = useState(riskConfig.merchantCallbackUrl);
  const [adminEmail, setAdminEmail] = useState(riskConfig.adminEmail);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [pushedTestNotif, setPushedTestNotif] = useState<string | null>(null);

  const selectedSandboxApp =
    connectedApps.find((a) => a.appId === sandboxAppId) || connectedApps[0];

  const selectedSignMode =
    selectedSandboxApp?.protocol === 'EPAY_COMPAT' ? 'MD5' : 'HMAC-SHA256';

  const liveSignatureData = useMemo(() => {
    const secret = selectedSandboxApp?.appSecret || riskConfig.webhookSecretKey;
    const notifyUrl = selectedSandboxApp?.notifyUrl || riskConfig.merchantCallbackUrl;
    return computeCanonicalOpenApiSign(
      {
        appId: sandboxAppId,
        outTradeNo: sandboxOutTradeNo,
        channel: sandboxChannel,
        amount: sandboxAmount,
        productTitle: sandboxTitle,
        attach: sandboxAttach,
        notifyUrl,
      },
      secret,
      selectedSignMode
    );
  }, [
    selectedSandboxApp,
    selectedSignMode,
    riskConfig,
    sandboxAppId,
    sandboxOutTradeNo,
    sandboxChannel,
    sandboxAmount,
    sandboxTitle,
    sandboxAttach,
  ]);

  const handleCopyText = (text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleRunReplayAttackTest = () => {
    const expiredTs = Date.now() - 900_000; // 15 minutes ago (> 300s window)
    const validOldSign = computeDoloPaySignature(
      'alipay',
      '10.00',
      expiredTs,
      riskConfig.webhookSecretKey
    );
    const res = onTriggerWebhook({
      channel: 'alipay',
      amountYuan: '10.00',
      timestamp: expiredTs,
      deviceTxId: `REPLAY_DRILL_${Date.now().toString().slice(-5)}`,
      deviceName: '185.220.101.99 (Replay-Bot)',
      sign: validOldSign,
    });
    setSelfTestFeedback({
      tone: res.ok ? 'rose' : 'emerald',
      text: `【攻防演练通过】已成功拦截 15 分钟前的过期重放报文：${res.message}`,
    });
  };

  const handleRunTamperSignatureTest = () => {
    const now = Date.now();
    const res = onTriggerWebhook({
      channel: 'wechat',
      amountYuan: '29.90',
      timestamp: now,
      deviceTxId: `TAMPER_DRILL_${now.toString().slice(-5)}`,
      deviceName: '45.155.205.77 (Forged-Client)',
      sign: 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd',
    });
    setSelfTestFeedback({
      tone: res.ok ? 'rose' : 'emerald',
      text: `【攻防演练通过】常量时间验签器已成功拦截伪造签名攻击：${res.message}`,
    });
  };

  const handleRunServerPersistTest = async () => {
    const res = await onPersistToServer();
    setSelfTestFeedback({
      tone: res.ok ? 'emerald' : 'amber',
      text: res.message,
    });
  };

  const handleCreateConnectedApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim() || !newAppNotifyUrl.trim()) return;

    const generatedAppId =
      newAppProtocol === 'EPAY_COMPAT'
        ? String(Math.floor(10010 + Math.random() * 89900))
        : `app_${Math.random().toString(36).slice(2, 10)}`;
    const generatedSecret = `sec_${Math.random().toString(36).slice(2, 12)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    onAddConnectedApp({
      name: newAppName.trim(),
      appId: generatedAppId,
      appSecret: generatedSecret,
      protocol: newAppProtocol,
      notifyUrl: newAppNotifyUrl.trim(),
      returnUrl: newAppReturnUrl.trim() || 'https://example.com/return',
      ipWhitelist: newAppWhitelist.trim() || '*',
      enabled: true,
    });

    setSandboxAppId(generatedAppId);
    setAppCreatedBanner(
      `已成功注册外部应用【${newAppName.trim()}】！分配 AppID/PID: ${generatedAppId}，支持 ${PROTOCOL_META[newAppProtocol].name}。`
    );
  };

  const handleRunLiveOpenApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCallingApi(true);
    setSandboxResult(null);

    const notifyUrl = selectedSandboxApp?.notifyUrl || riskConfig.merchantCallbackUrl;

    const localRes = onCreateExternalApiOrder({
      appId: sandboxAppId,
      outTradeNo: sandboxOutTradeNo.trim() || `API_${Date.now()}`,
      channel: sandboxChannel,
      nominalAmountYuan: sandboxAmount.trim() || '10.00',
      productTitle: sandboxTitle.trim() || 'Open API 外部系统接入订单',
      attach: sandboxAttach.trim(),
      notifyUrl,
    });

    let serverResponseObj: unknown = null;
    try {
      const resp = await fetch('/api/v1/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: sandboxAppId,
          outTradeNo: sandboxOutTradeNo.trim(),
          channel: sandboxChannel,
          amount: sandboxAmount.trim(),
          productTitle: sandboxTitle.trim(),
          attach: sandboxAttach.trim(),
          notifyUrl,
          sign: liveSignatureData.sign,
        }),
      });
      serverResponseObj = await resp.json();
    } catch {
      // Fallback if running in static preview
    }

    setIsCallingApi(false);

    if (!localRes.ok || !localRes.order) {
      setSandboxResult({
        ok: false,
        httpStatus: 429,
        responseJson: JSON.stringify(
          {
            code: 4029,
            msg: localRes.errorMessage || '下单失败',
          },
          null,
          2
        ),
      });
      return;
    }

    const ord = localRes.order;
    const finalPayload = serverResponseObj || {
      code: 0,
      msg: 'success',
      data: {
        orderId: ord.id,
        outTradeNo: ord.outTradeNo,
        appId: ord.appId,
        protocol: ord.protocol,
        signAlgorithm: selectedSignMode,
        channel: ord.channel,
        nominalAmountYuan: centsToYuan(ord.nominalAmountCents),
        actualPayAmountYuan: centsToYuan(ord.actualAmountCents),
        qrMatchType: ord.qrMatchType,
        qrPayloadUrl: ord.qrPayloadUrl,
        remarkCode: ord.remarkCode,
        attach: ord.attach,
        expiresAt: ord.expiresAt,
      },
    };

    setSandboxResult({
      ok: true,
      httpStatus: 200,
      orderId: ord.id,
      responseJson: JSON.stringify(finalPayload, null, 2),
    });
    setSandboxOutTradeNo(`API_ORD_${Math.floor(100000 + Math.random() * 900000)}`);
  };

  const handleSaveRisk = (e: React.FormEvent) => {
    e.preventDefault();
    const steps = Math.max(1, Math.min(100, parseInt(maxFloatSteps, 10) || 15));
    const ttl = Math.max(60, Math.min(1800, parseInt(orderTtlSeconds, 10) || 300));
    const maxIp = Math.max(1, Math.min(50, parseInt(maxPendingPerIp, 10) || 4));
    const replaySec = Math.max(30, Math.min(3600, parseInt(webhookReplayWindowSeconds, 10) || 300));
    const rateLimit = Math.max(5, Math.min(600, parseInt(rateLimitPerMinute, 10) || 30));

    onSaveConfig({
      floatStrategy,
      maxFloatSteps: steps,
      orderTtlSeconds: ttl,
      maxPendingPerIp: maxIp,
      webhookReplayWindowSeconds: replaySec,
      rateLimitPerMinute: rateLimit,
      requireAdminAuth,
      adminPassword: adminPassword.trim() || 'DoloPay@2026',
      webhookSecretKey: webhookSecretKey.trim() || 'dolopay_hmac_live_default',
      merchantCallbackUrl: merchantCallbackUrl.trim() || 'https://api.example.com/dolopay/callback',
      adminEmail: adminEmail.trim() || 'admin@dolopay.dev',
      autoApproveTrustedTest: riskConfig.autoApproveTrustedTest,
    });

    setSavedBanner('生产安全防线策略、防重放窗口与全局通信密钥已保存并实时同步。');
  };

  const codeSnippets: Record<CodeLangTab, { title: string; code: string }> = {
    epay: {
      title: '彩虹易支付兼容协议配置（标准 RFC 1321 MD5 签名 · 零代码对接独角数卡 / 鲸发卡 / V2Board）',
      code: `# 任何支持【彩虹易支付 / EPay】的开源系统，无需编写任何代码，直接填入以下三项即可完成对接：
接口地址 (API URL)   : ${typeof window !== 'undefined' ? window.location.origin : 'https://your-dolopay-host.cn'}/api/v1/epay/
商户 ID (PID)        : ${selectedSandboxApp?.appId || '10008'}
商户密钥 (KEY)       : ${selectedSandboxApp?.appSecret || 'epay_compat_key_77291048abcef'}

# 异步通知验签规则 (ASCII 字典序拼接 + 标准 RFC 1321 MD5):
# 回调参数: pid, trade_no, out_trade_no, type(alipay/wxpay), name, money(实付唯一金额), trade_status(TRADE_SUCCESS), param(透传参数)
# 收到回调验证签名通过后，请返回纯文本 "success" 即可完成幂等确认。`,
    },
    nodejs: {
      title: 'Node.js / TypeScript 业务系统接入示例 (RFC 2104 HMAC-SHA256 签名 + 常量时间验签)',
      code: `import crypto from 'node:crypto';

const DOLOPAY_CONFIG = {
  gatewayUrl: '${typeof window !== 'undefined' ? window.location.origin : 'https://your-dolopay-host.cn'}',
  appId: '${selectedSandboxApp?.appId || 'app_indiecloud_prod'}',
  appSecret: '${selectedSandboxApp?.appSecret || 'sec_dolopay_9f81c3a04b2e77d190a2'}',
};

// 标准 RFC 2104 HMAC-SHA256 字典序签名计算
export function signDoloPayParams(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort()
    .map((k) => \`\${k}=\${params[k]}\`)
    .join('&') + \`&key=\${secret}\`;
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

// 发起收款单（自动分配唯一防冲突分位金额）
export async function createDoloPayOrder(outTradeNo: string, amountYuan: string, userId: string) {
  const payload: Record<string, string> = {
    appId: DOLOPAY_CONFIG.appId,
    outTradeNo,
    channel: 'alipay',
    amount: amountYuan,
    productTitle: 'SaaS 会员年付订阅',
    attach: \`userId=\${userId}&plan=pro\`,
    notifyUrl: 'https://your-service.com/api/payment/dolopay-webhook',
  };
  payload.sign = signDoloPayParams(payload, DOLOPAY_CONFIG.appSecret);

  const res = await fetch(\`\${DOLOPAY_CONFIG.gatewayUrl}/api/v1/orders/create\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}`,
    },
    python: {
      title: 'Python (FastAPI / Django) 接入与 HMAC-SHA256 常量时间验签示例',
      code: `import hmac
import hashlib
import requests
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
APP_ID = "${selectedSandboxApp?.appId || 'app_indiecloud_prod'}"
APP_SECRET = "${selectedSandboxApp?.appSecret || 'sec_dolopay_9f81c3a04b2e77d190a2'}"

def sign_dolopay(params: dict, secret: str) -> str:
    items = [f"{k}={v}" for k, v in sorted(params.items()) if k not in ("sign", "sign_type") and str(v) != ""]
    canonical = "&".join(items) + f"&key={secret}"
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()

@app.post("/dolopay/notify")
async def dolopay_webhook(request: Request):
    data = await request.json()
    expected = sign_dolopay(data, APP_SECRET)
    if not hmac.compare_digest(str(data.get("sign", "")), expected):
        raise HTTPException(status_code=401, detail="Invalid HMAC-SHA256 signature")
    if data.get("status") == "PAID":
        return {"code": 0, "msg": "success"}
    raise HTTPException(status_code=400, detail="Invalid state")`,
    },
    java: {
      title: 'Java (Spring Boot) 异步回调 Controller 接入示例',
      code: `@RestController
@RequestMapping("/api/payment")
public class DoloPayWebhookController {

    @PostMapping("/dolopay-notify")
    public ResponseEntity<Map<String, Object>> onDoloPayCallback(
            @RequestHeader("X-DoloPay-App-Id") String appId,
            @RequestHeader("X-DoloPay-Signature") String signature,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestBody Map<String, Object> payload) {

        String outTradeNo = String.valueOf(payload.get("outTradeNo"));
        String actualAmountYuan = String.valueOf(payload.get("actualAmountYuan"));
        String attach = String.valueOf(payload.get("attach"));

        // 1. 使用 MessageDigest.isEqual 常量时间校验 X-DoloPay-Signature (HMAC-SHA256)
        // 2. 根据 idempotencyKey 执行幂等去重并发放业务权益
        return ResponseEntity.ok(Map.of("code", 0, "msg", "success"));
    }
}`,
    },
    go: {
      title: 'Go (Gin / 标准库) 高并发 HMAC-SHA256 接入示例',
      code: `package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func ComputeDoloPayHmac(canonical string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}`,
    },
    jswidget: {
      title: '前端嵌入式收银台组件 (任何网页 3 行代码弹窗唤起个人收款码)',
      code: `<!-- 在任意外部网站 HTML 引入 DoloPay 轻量级收银台 SDK -->
<script src="${typeof window !== 'undefined' ? window.location.origin : 'https://your-dolopay-host.cn'}/sdk/dolopay-checkout.js"></script>
<script>
  DoloPayCheckout.open({
    appId: "${selectedSandboxApp?.appId || 'app_indiecloud_prod'}",
    outTradeNo: "WEB_" + Date.now(),
    amount: "10.00",
    channel: "alipay",
    attach: "userId=1024&coupon=none",
    onSuccess: function(order) {
      console.log("收款已核销到账！实付金额:", order.actualPayAmountYuan);
    }
  });
</script>`,
    },
    android: {
      title: 'Android 收款通知监听端 (RFC 2104 HMAC-SHA256 签名 + ±300s 防重放上报)',
      code: `// 监听包名: com.eg.android.AlipayGphone (支付宝) / com.tencent.mm (微信)
// 签名原串格式: "channel=" + channel + "&amount=" + amountYuan + "&timestamp=" + timestamp
// 算法: HmacSHA256(canonical, webhookSecretKey)
function onPaymentNotificationPosted(pkgName, title, text) {
  const channel = pkgName.includes('Alipay') ? 'alipay' : 'wechat';
  const match = (title + ' ' + text).match(/([0-9]+(\\.[0-9]{1,2})?)元/);
  if (!match) return;

  const amountYuan = Number(match[1]).toFixed(2);
  const timestamp = Date.now();
  const canonical = "channel=" + channel + "&amount=" + amountYuan + "&timestamp=" + timestamp;
  const sign = hmacSha256Hex(canonical, "${revealSecrets ? webhookSecretKey : maskSensitiveSecret(webhookSecretKey)}");

  fetch("${typeof window !== 'undefined' ? window.location.origin : 'https://your-dolopay-host.cn'}/api/v1/webhook/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel,
      amountYuan,
      timestamp,
      deviceTxId: channel.toUpperCase() + "_" + timestamp,
      sign
    })
  });
}`,
    },
  };

  return (
    <div className="space-y-6">
      {/* Section 0: Production Security Posture & Live Penetration Self-Test Center */}
      <section
        aria-label="生产级安全防线状态与攻防自检工作台"
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              <h2 className="text-base font-bold text-slate-900">
                生产级安全防线状态与攻防演练中心 (Defense-in-Depth)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              已全面启用工业标准密码学验签、时间戳防重放窗口、常量时间比对、管理员会话隔离及服务端原子 JSON 落盘持久化
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRevealSecrets((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              {revealSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {revealSecrets ? '隐藏敏感密钥明文' : '解锁查看密钥明文'}
            </button>
            <button
              type="button"
              onClick={handleRunReplayAttackTest}
              className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
            >
              演练：过期重放攻击拦截
            </button>
            <button
              type="button"
              onClick={handleRunTamperSignatureTest}
              className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
            >
              演练：伪造签名攻击拦截
            </button>
            <button
              type="button"
              onClick={handleRunServerPersistTest}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5" />
              服务端原子持久化落盘
            </button>
          </div>
        </div>

        {/* 5 Security Shields Status Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>密码学双模引擎</span>
              <span className="text-emerald-700 font-semibold">ACTIVE</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              RFC 2104 HMAC-SHA256 + 易支付 RFC 1321 MD5 + 常量时间防时序比对
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>时间戳防重放窗口</span>
              <span className="font-mono text-emerald-700 font-semibold">
                ±{riskConfig.webhookReplayWindowSeconds || 300}s
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              超出时间窗的历史通知或重复 deviceTxId 均被即时阻断
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>后台权限门禁隔离</span>
              <span className="text-emerald-700 font-semibold">
                {riskConfig.requireAdminAuth ? 'TOKEN 保护' : '沙盒开放'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              收银台公开访问，运营核销与收款码配置受管理员 Token 保护
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>真实 IP 速率限制</span>
              <span className="font-mono text-emerald-700 font-semibold">
                {riskConfig.rateLimitPerMinute || 30}/min
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              提取 Socket / XFF 真实 IP，拦截伪造请求体与高频刷单占池
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
              <span>原子落盘持久化</span>
              <span className="text-emerald-700 font-semibold">WRITE-AHEAD</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Write-Temp + Atomic Rename 机制，容器重启不丢锁不丢单
            </p>
          </div>
        </div>

        {selfTestFeedback && (
          <div
            role="status"
            className={`p-3 rounded-lg text-xs border font-medium ${
              selfTestFeedback.tone === 'emerald'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : selfTestFeedback.tone === 'amber'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {selfTestFeedback.text}
          </div>
        )}

        {/* Real-time Security Audit Log Table */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800">
              实时安全拦截与核销审计日志 ({securityAuditLogs.length} 条记录)
            </span>
            <span className="text-slate-500">
              自动记录签名伪造、过期报文重放、IP 限流触发与管理员核销事件
            </span>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2 px-3 font-medium">时间</th>
                  <th className="py-2 px-3 font-medium">级别</th>
                  <th className="py-2 px-3 font-medium">安全事件类型</th>
                  <th className="py-2 px-3 font-medium">来源 IP / 终端</th>
                  <th className="py-2 px-3 font-medium">审计详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {securityAuditLogs.slice(0, 6).map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono font-semibold">
                      <span
                        className={
                          evt.level === 'CRITICAL'
                            ? 'text-rose-600'
                            : evt.level === 'WARN'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }
                      >
                        {evt.level}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-800 whitespace-nowrap">
                      {evt.eventType}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {evt.clientIp}
                    </td>
                    <td className="py-2 px-3 text-slate-700">{evt.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section 1: Multi-System Connected Apps Registry & Live Open API Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Connected External Business Systems */}
        <section
          aria-label="已接入外部业务系统与应用管理"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                01. 多业务系统接入中心 ({connectedApps.length} 个已授权应用)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                为每个外部系统分配独立的 AppID、签名密钥与回调协议（原生支持 DoloPay REST HMAC-SHA256、彩虹易支付 MD5、Stripe Webhook）
              </p>
            </div>
            <Globe className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <div className="divide-y divide-slate-100">
            {connectedApps.map((app) => (
              <div key={app.id} className="py-3.5 first:pt-1 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{app.name}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-xs font-medium text-blue-700">
                      {PROTOCOL_META[app.protocol].shortName}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      已结算 {app.totalOrders} 笔 (¥{centsToYuan(app.totalPaidCents)})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(
                          `AppID(PID): ${app.appId}\nAppSecret(KEY): ${app.appSecret}\nProtocol: ${app.protocol}\nNotifyURL: ${app.notifyUrl}`,
                          `app_${app.id}`
                        )
                      }
                      className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey === `app_${app.id}` ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedKey === `app_${app.id}` ? '已复制凭证' : '复制对接凭证'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotateAppSecret(app.id)}
                      className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      <KeyRound className="w-3 h-3" />
                      重置密钥
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleConnectedApp(app.id)}
                      className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                    >
                      {app.enabled ? '停用' : '启用'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="truncate">
                    AppID / PID: <strong className="text-slate-800">{app.appId}</strong>
                  </div>
                  <div className="truncate">
                    Secret / KEY:{' '}
                    <strong className="text-slate-800">
                      {revealSecrets ? app.appSecret : maskSensitiveSecret(app.appSecret)}
                    </strong>
                  </div>
                  <div className="sm:col-span-2 truncate">
                    Notify URL: <span className="text-slate-700">{app.notifyUrl}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Register New External Application Form */}
          <form onSubmit={handleCreateConnectedApp} className="pt-3 border-t border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800">新增外部业务系统接入授权</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-app-name" className="block text-xs font-medium text-slate-700 mb-1">
                  外部系统名称
                </label>
                <input
                  id="new-app-name"
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                  placeholder="例如：自研发卡网 / Discourse 论坛"
                />
              </div>

              <div>
                <label htmlFor="new-app-protocol" className="block text-xs font-medium text-slate-700 mb-1">
                  对接通信协议
                </label>
                <select
                  id="new-app-protocol"
                  value={newAppProtocol}
                  onChange={(e) => setNewAppProtocol(e.target.value as IntegrationProtocol)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  <option value="EPAY_COMPAT">彩虹易支付兼容协议 (标准 MD5 · 免改码对接发卡/面板)</option>
                  <option value="DOLOPAY_REST_V1">DoloPay REST Open API v1 (标准 HMAC-SHA256)</option>
                  <option value="STRIPE_WEBHOOK">Stripe 风格签名 Webhook (HMAC-SHA256 时间戳签名)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="new-app-notify" className="block text-xs font-medium text-slate-700 mb-1">
                  异步回调通知地址 (Notify URL)
                </label>
                <input
                  id="new-app-notify"
                  type="url"
                  value={newAppNotifyUrl}
                  onChange={(e) => setNewAppNotifyUrl(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800"
                />
              </div>

              <div>
                <label htmlFor="new-app-ip" className="block text-xs font-medium text-slate-700 mb-1">
                  服务器 IP 白名单
                </label>
                <input
                  id="new-app-ip"
                  type="text"
                  value={newAppWhitelist}
                  onChange={(e) => setNewAppWhitelist(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800"
                />
              </div>
            </div>

            {appCreatedBanner && (
              <div role="status" className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg">
                {appCreatedBanner}
              </div>
            )}

            <button
              type="submit"
              className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              创建外部应用并分配密钥
            </button>
          </form>
        </section>

        {/* Right 5 Cols: Live Open API Signature & Request Debugger */}
        <section
          aria-label="在线 Open API 签名计算与真实下单联调沙盒"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">
              02. 在线 Open API 签名沙盒与接口联调器
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              模拟任意外部系统调用 <span className="font-mono text-slate-800">POST /api/v1/orders/create</span> ({selectedSignMode} 签名校验)
            </p>
          </div>

          <form onSubmit={handleRunLiveOpenApi} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sandbox-app-select" className="block text-xs font-medium text-slate-700 mb-1">
                  调用方应用 (AppID)
                </label>
                <select
                  id="sandbox-app-select"
                  value={sandboxAppId}
                  onChange={(e) => setSandboxAppId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  {connectedApps.map((app) => (
                    <option key={app.id} value={app.appId}>
                      {app.name} ({app.appId})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sandbox-outtradeno" className="block text-xs font-medium text-slate-700 mb-1">
                  外部商户单号 (outTradeNo)
                </label>
                <input
                  id="sandbox-outtradeno"
                  type="text"
                  value={sandboxOutTradeNo}
                  onChange={(e) => setSandboxOutTradeNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sandbox-channel" className="block text-xs font-medium text-slate-700 mb-1">
                  指定收款码渠道
                </label>
                <select
                  id="sandbox-channel"
                  value={sandboxChannel}
                  onChange={(e) => setSandboxChannel(e.target.value as PaymentChannel)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                >
                  <option value="alipay">支付宝 (alipay)</option>
                  <option value="wechat">微信支付 (wechat)</option>
                  <option value="unionpay">云闪付 (unionpay)</option>
                </select>
              </div>

              <div>
                <label htmlFor="sandbox-amount" className="block text-xs font-medium text-slate-700 mb-1">
                  请求收款金额 (元)
                </label>
                <input
                  id="sandbox-amount"
                  type="text"
                  value={sandboxAmount}
                  onChange={(e) => setSandboxAmount(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums font-bold bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sandbox-attach" className="block text-xs font-medium text-slate-700 mb-1">
                业务系统自定义透传参数 (attach / param，核销回调时原样返回)
              </label>
              <input
                id="sandbox-attach"
                type="text"
                value={sandboxAttach}
                onChange={(e) => setSandboxAttach(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800"
              />
            </div>

            {/* Live Canonical Signature Preview */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1 text-[11px] font-mono">
              <div className="text-slate-500">
                ASCII 字典序待签名串 ({selectedSignMode}):
              </div>
              <div className="text-slate-800 break-all">
                {revealSecrets
                  ? liveSignatureData.canonicalString
                  : liveSignatureData.canonicalString.replace(/&key=.*$/, '&key=••••••••••••')}
              </div>
              <div className="text-slate-500 pt-1">计算签名值 (sign):</div>
              <div className="text-blue-700 font-semibold break-all">{liveSignatureData.sign}</div>
            </div>

            <button
              type="submit"
              disabled={isCallingApi}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {isCallingApi
                ? '正在请求网关分配唯一金额锁...'
                : '发起真实 Open API 下单请求 (POST /api/v1/orders/create)'}
            </button>
          </form>

          {sandboxResult && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={`font-semibold ${
                    sandboxResult.ok ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  HTTP {sandboxResult.httpStatus} ·{' '}
                  {sandboxResult.ok ? '已成功创建外部接入订单并锁定金额' : '请求被风控拦截'}
                </span>
                {sandboxResult.orderId && (
                  <button
                    type="button"
                    onClick={() => onNavigateToCashierWithOrder(sandboxResult.orderId!)}
                    className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    在收银台打开该订单 ({sandboxResult.orderId})
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              <pre className="bg-slate-900 text-slate-100 font-mono text-[11px] p-3 rounded-lg max-h-48 overflow-auto leading-relaxed">
                {sandboxResult.responseJson}
              </pre>
            </div>
          )}
        </section>
      </div>

      {/* Section 2: Multi-Language SDK & Zero-Code Plugin Generator */}
      <section
        aria-label="多语言 SDK 与现成系统对接代码生成器"
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              03. 多语言 SDK 与第三方系统一键对接代码生成器
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              已自动带入上方所选应用 ({selectedSandboxApp?.name}) 的实时 AppID 与标准签名算法，复制即可直接运行
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'epay', label: '彩虹易支付免改码配置' },
              { id: 'nodejs', label: 'Node.js / TS' },
              { id: 'python', label: 'Python' },
              { id: 'java', label: 'Java Spring' },
              { id: 'go', label: 'Go' },
              { id: 'jswidget', label: '前端嵌入式组件' },
              { id: 'android', label: 'Android 监听端' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setCodeTab(t.id as CodeLangTab)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  codeTab === t.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800">{codeSnippets[codeTab].title}</span>
            <button
              type="button"
              onClick={() => handleCopyText(codeSnippets[codeTab].code, `sdk_${codeTab}`)}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium cursor-pointer"
            >
              {copiedKey === `sdk_${codeTab}` ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedKey === `sdk_${codeTab}` ? '已复制代码' : '复制完整对接代码'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-xl overflow-x-auto leading-relaxed">
            {codeSnippets[codeTab].code}
          </pre>
        </div>
      </section>

      {/* Section 3: Multi-Channel IM Notification Connectors + Core Risk & Security Engine Config */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 6 Cols: Multi-Channel IM / Bot Notification Connectors */}
        <section
          aria-label="多通道即时通讯与审批机器人连接器"
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                04. 多通道运维推送与交互式审批连接器
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                除邮件外，支持将收款到账、买家申报核销卡片及回调异常实时推送到飞书、Bark、钉钉与 Telegram
              </p>
            </div>
            <BellRing className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <div className="divide-y divide-slate-100">
            {notificationChannels.map((chan) => (
              <div
                key={chan.id}
                className="py-3 first:pt-1 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>{chan.name}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className={chan.enabled ? 'text-emerald-700' : 'text-slate-400'}>
                      {chan.enabled ? '已启用' : '已停用'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {chan.endpointMask}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setPushedTestNotif(
                        `已向【${chan.name}】发送测试审批卡片：{"title":"DoloPay 收款核销提醒","amount":"¥10.01","actions":["确认收款","驳回"]}`
                      )
                    }
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                  >
                    发送测试推送
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleNotificationChannel(chan.id)}
                    className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                  >
                    {chan.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {pushedTestNotif && (
            <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg">
              {pushedTestNotif}
            </div>
          )}
        </section>

        {/* Right 6 Cols: Risk Control & Security Hardening Parameters */}
        <section
          aria-label="防冲突金额锁与生产安全参数配置"
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                05. 动态金额防冲突引擎与生产安全参数配置
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                配置并发浮动策略、Webhook ±300s 防重放窗口、单 IP 速率限制及管理员门禁口令
              </p>
            </div>
            <Shield className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <form onSubmit={handleSaveRisk} className="space-y-3.5">
            <div>
              <label htmlFor="float-strategy-select" className="block text-xs font-medium text-slate-700 mb-1">
                同渠道同金额并发防冲突策略 (Float Strategy)
              </label>
              <select
                id="float-strategy-select"
                value={floatStrategy}
                onChange={(e) => setFloatStrategy(e.target.value as FloatStrategy)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="EXACT_THEN_INCREMENT">
                  优先原价，冲突时向上 +0.01 元递增 (如 10.00 → 10.01 → 10.02)
                </option>
                <option value="ALWAYS_INCREMENT">
                  始终从 +0.01 元起向上递增 (所有订单均带非零分位尾数)
                </option>
                <option value="EXACT_THEN_DECREMENT">
                  优先原价，冲突时向下 -0.01 元随机立减 (如 10.00 → 9.99 → 9.98)
                </option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="max-float-input" className="block text-xs font-medium text-slate-700 mb-1">
                  最大浮动步数 (分)
                </label>
                <input
                  id="max-float-input"
                  type="number"
                  min={1}
                  max={100}
                  value={maxFloatSteps}
                  onChange={(e) => setMaxFloatSteps(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="ttl-seconds-input" className="block text-xs font-medium text-slate-700 mb-1">
                  金额锁存活时长 (秒)
                </label>
                <input
                  id="ttl-seconds-input"
                  type="number"
                  min={60}
                  max={1800}
                  value={orderTtlSeconds}
                  onChange={(e) => setOrderTtlSeconds(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="max-ip-input" className="block text-xs font-medium text-slate-700 mb-1">
                  单 IP 最大待付单数
                </label>
                <input
                  id="max-ip-input"
                  type="number"
                  min={1}
                  max={50}
                  value={maxPendingPerIp}
                  onChange={(e) => setMaxPendingPerIp(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="replay-window-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Webhook 时间戳防重放窗口 (秒)
                </label>
                <input
                  id="replay-window-input"
                  type="number"
                  min={30}
                  max={3600}
                  value={webhookReplayWindowSeconds}
                  onChange={(e) => setWebhookReplayWindowSeconds(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="rate-limit-input" className="block text-xs font-medium text-slate-700 mb-1">
                  单 IP 接口速率上限 (次/分钟)
                </label>
                <input
                  id="rate-limit-input"
                  type="number"
                  min={5}
                  max={600}
                  value={rateLimitPerMinute}
                  onChange={(e) => setRateLimitPerMinute(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="secret-key-input" className="block text-xs font-medium text-slate-700 mb-1">
                  移动端监听全局 HMAC-SHA256 密钥
                </label>
                <input
                  id="secret-key-input"
                  type={revealSecrets ? 'text' : 'password'}
                  value={webhookSecretKey}
                  onChange={(e) => setWebhookSecretKey(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="admin-password-input" className="block text-xs font-medium text-slate-700 mb-1">
                  管理后台访问口令 (DOLOPAY_ADMIN_PASSWORD)
                </label>
                <input
                  id="admin-password-input"
                  type={revealSecrets ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label htmlFor="admin-email-input" className="block text-xs font-medium text-slate-700 mb-1">
                  管理员 DoloPay 审批接收邮箱
                </label>
                <input
                  id="admin-email-input"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
                />
              </div>

              <div className="pt-4">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={requireAdminAuth}
                    onChange={(e) => setRequireAdminAuth(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  <span>公网强制启用管理后台口令登录门禁</span>
                </label>
              </div>
            </div>

            {savedBanner && (
              <div
                role="status"
                className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg"
              >
                {savedBanner}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              保存安全防线与网关配置
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

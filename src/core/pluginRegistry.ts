/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OptionalPluginId =
  | 'unionpay'
  | 'bark'
  | 'telegram'
  | 'epay'
  | 'stripe'
  | 'androidListener'
  | 'centFloat';

export type PluginCategory = 'channel' | 'notifier' | 'protocol' | 'automation';

export interface PluginDescriptor {
  id: OptionalPluginId;
  name: string;
  shortName: string;
  category: PluginCategory;
  description: string;
  defaultEnabled: boolean;
}

export type PluginStates = Record<OptionalPluginId, boolean>;

/**
 * 内置可扩展插件注册表
 * 二次开发者如需彻底裁剪某个扩展，直接从本数组移除对应项或通过 DOLOPAY_DISABLED_PLUGINS 屏蔽即可。
 */
export const OPTIONAL_PLUGIN_REGISTRY: PluginDescriptor[] = [
  {
    id: 'unionpay',
    name: '云闪付收款渠道 (UnionPay)',
    shortName: '云闪付',
    category: 'channel',
    description: '开启后在收款码配置与收银台新增银联云闪付个人收款码通道，默认关闭以保持支付宝/微信双通道极简体验。',
    defaultEnabled: false,
  },
  {
    id: 'bark',
    name: 'Bark iOS 推送扩展',
    shortName: 'Bark',
    category: 'notifier',
    description: '在默认的邮件/飞书/钉钉之外，增加 Bark 实时强提醒推送，点击通知直接打开手机审批确认页。',
    defaultEnabled: false,
  },
  {
    id: 'telegram',
    name: 'Telegram Bot 审批扩展',
    shortName: 'Telegram',
    category: 'notifier',
    description: '通过 Telegram Bot 发送带内联审批按钮的付款提醒消息，适合海外独立开发者使用。',
    defaultEnabled: false,
  },
  {
    id: 'epay',
    name: '易支付兼容协议 (EPay Compat · MD5)',
    shortName: '易支付协议',
    category: 'protocol',
    description: '启用 RFC 1321 MD5 易支付兼容接口与回调格式，零代码对接独角数卡、鲸发卡、V2Board、WHMCS 等开源系统。',
    defaultEnabled: false,
  },
  {
    id: 'stripe',
    name: 'Stripe 风格签名事件流',
    shortName: 'Stripe Webhook',
    category: 'protocol',
    description: '支持采用 X-DoloPay-Signature: t=...,v1=... 时间戳防重放格式的下游回调协议。',
    defaultEnabled: false,
  },
  {
    id: 'androidListener',
    name: '安卓通知栏监听 Webhook',
    shortName: '安卓监听',
    category: 'automation',
    description: '启用 /api/v1/webhook/notify 签名回调接口，配合闲置安卓机 Tasker/监听插件实现到账自动核销。',
    defaultEnabled: false,
  },
  {
    id: 'centFloat',
    name: '并发分位金额浮动锁 (±0.01)',
    shortName: '分位浮动锁',
    category: 'automation',
    description: '默认关闭（按原价 + 6位付款口令核对）；开启后同渠道同金额并发下单自动分配 +0.01 唯一尾数，方便配合安卓监听全自动匹配。',
    defaultEnabled: false,
  },
];

export function createDefaultPluginStates(): PluginStates {
  return {
    unionpay: false,
    bark: false,
    telegram: false,
    epay: false,
    stripe: false,
    androidListener: false,
    centFloat: false,
  };
}

/**
 * 解析环境变量与持久化配置合并后的插件启停状态
 * - DOLOPAY_ENABLED_PLUGINS=unionpay,epay  强制开启指定插件
 * - DOLOPAY_DISABLED_PLUGINS=stripe,bark   强制锁定关闭指定插件
 */
export function resolvePluginStates(
  stored?: Partial<PluginStates>,
  envEnabledCsv?: string,
  envDisabledCsv?: string
): { states: PluginStates; lockedDisabled: OptionalPluginId[] } {
  const states: PluginStates = {
    ...createDefaultPluginStates(),
    ...(stored || {}),
  };

  const validIds = new Set<string>(OPTIONAL_PLUGIN_REGISTRY.map((p) => p.id));

  if (envEnabledCsv && envEnabledCsv.trim()) {
    for (const raw of envEnabledCsv.split(',')) {
      const id = raw.trim() as OptionalPluginId;
      if (validIds.has(id)) {
        states[id] = true;
      }
    }
  }

  const lockedDisabled: OptionalPluginId[] = [];
  if (envDisabledCsv && envDisabledCsv.trim()) {
    for (const raw of envDisabledCsv.split(',')) {
      const id = raw.trim() as OptionalPluginId;
      if (validIds.has(id)) {
        states[id] = false;
        lockedDisabled.push(id);
      }
    }
  }

  return { states, lockedDisabled };
}

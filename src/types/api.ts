/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConnectedApp,
  DashboardMetrics,
  DoloPayOrder,
  GatewaySettings,
  PaymentChannel,
  QrChannelSlot,
  SecurityAuditEvent,
} from '../core/dolopayEngine';
import type { OptionalPluginId, PluginDescriptor } from '../core/pluginRegistry';

export interface QrSlotWithImage extends QrChannelSlot {
  hasImage: boolean;
  imageSource: 'uploaded' | 'static' | 'none';
  imageUrl: string | null;
}

export interface PublicCashierConfig {
  siteTitle: string;
  orderTtlSeconds: number;
  centFloatEnabled: boolean;
  channels: PaymentChannel[];
  qrSlots: Record<string, QrSlotWithImage>;
  enabledNotifiers: string[];
}

export interface PublicOrderStatus {
  orderId: string;
  outTradeNo?: string;
  productTitle: string;
  channel: PaymentChannel;
  status: DoloPayOrder['status'];
  nominalAmountYuan: string;
  actualAmountYuan: string;
  remarkCode: string;
  expiresAt: number;
  paidAt: number | null;
  returnUrl?: string | null;
}

export interface AdminOrderRecord extends DoloPayOrder {
  approvalUrl: string;
}

export interface AdminStatePayload {
  detectedBaseUrl: string;
  authMode: 'ENV_PASSWORD' | 'CLAIMED_HASH' | 'NEEDS_BOOTSTRAP';
  metrics: DashboardMetrics;
  settings: GatewaySettings;
  pluginRegistry: PluginDescriptor[];
  lockedDisabledPlugins: OptionalPluginId[];
  qrSlots: Record<PaymentChannel, QrSlotWithImage>;
  connectedApps: ConnectedApp[];
  orders: AdminOrderRecord[];
  auditLogs: SecurityAuditEvent[];
}

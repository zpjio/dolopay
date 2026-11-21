/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import net from 'net';
import path from 'path';

export interface StoredPasswordHash {
  salt: string;
  hash: string;
}

export function hashAdminPassword(password: string): StoredPasswordHash {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyAdminPasswordHash(password: string, stored: StoredPasswordHash): boolean {
  if (!stored?.salt || !stored?.hash) return false;
  try {
    const derived = crypto.scryptSync(password, stored.salt, 64);
    const expected = Buffer.from(stored.hash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateSecureSecret(prefix: string, bytes = 20): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

/**
 * 校验浏览器跳转 URL（如 returnUrl / publicBaseUrl），仅允许 http:// 或 https://，阻止 javascript: / data: 等 XSS 伪协议
 */
export function validateSafeHttpUrl(
  rawUrl: string
): { ok: true; normalizedUrl: string; origin: string } | { ok: false; error: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'URL 不能为空' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URL 格式无效，请填写完整的 http:// 或 https:// 地址' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '仅允许 http:// 或 https:// 协议地址' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL 中禁止包含认证凭据信息' };
  }
  return {
    ok: true,
    normalizedUrl: parsed.toString(),
    origin: parsed.origin,
  };
}

/**
 * 严格校验并清洗 HTTP 请求头中的 protocol 与 host，防御 Host Header Poisoning
 */
export function sanitizeOriginFromHeaders(
  rawProto: string | undefined,
  rawHost: string | undefined
): string | null {
  const proto = String(rawProto || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto !== 'http' && proto !== 'https') {
    return null;
  }
  const host = String(rawHost || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) {
    return null;
  }
  return `${proto}://${host}`;
}

/**
 * 严格校验对外请求 URL，防止 SSRF 访问本机、IPv6 环回或内网敏感元数据地址
 */
export function validateSafeOutboundUrl(
  rawUrl: string,
  allowedHostSuffixes?: string[]
): { ok: true; url: URL } | { ok: false; error: string } {
  if (!rawUrl || !rawUrl.trim()) {
    return { ok: false, error: 'URL 不能为空' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'URL 格式无效' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: '仅支持 http:// 或 https:// 协议地址' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: '安全限制：回调 URL 禁止包含内嵌账号密码' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const bareHost = hostname.replace(/^\[|\]$/g, '');

  if (
    bareHost === 'localhost' ||
    bareHost.endsWith('.localhost') ||
    bareHost.endsWith('.local') ||
    bareHost.endsWith('.internal') ||
    bareHost.includes(':') ||
    net.isIP(bareHost) === 6
  ) {
    return { ok: false, error: '安全限制：禁止向本机、内网域名或 IPv6 字面量地址发起回调请求' };
  }

  // Block private, loopback, link-local, CGNAT, multicast, and reserved IPv4 ranges
  const ipv4Match = bareHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match || net.isIP(bareHost) === 4) {
    const parts = bareHost.split('.').map(Number);
    const [a, b] = [parts[0], parts[1]];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return { ok: false, error: '安全限制：禁止向私网、环回或保留 IPv4 地址发起回调请求' };
    }
  }

  if (allowedHostSuffixes && allowedHostSuffixes.length > 0) {
    const matched = allowedHostSuffixes.some(
      (suffix) => bareHost === suffix || bareHost.endsWith(`.${suffix}`)
    );
    if (!matched) {
      return {
        ok: false,
        error: `域名校验未通过，仅允许官方域名 (${allowedHostSuffixes.join(', ')})`,
      };
    }
  }

  return { ok: true, url: parsed };
}

/**
 * 严格限定文件访问路径在指定目录内，防御路径穿越
 */
export function resolveConfinedPath(baseDir: string, fileName: string): string | null {
  const safeBase = path.resolve(baseDir);
  const candidate = path.resolve(safeBase, fileName);
  if (!candidate.startsWith(safeBase + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * 解析并校验上传的二维码图片 Data URL（检查真实魔数，仅允许 PNG / JPEG / WebP，<= 2MB）
 */
export function parseAndValidateQrImageDataUrl(dataUrl: string): {
  ok: true;
  buffer: Buffer;
  ext: 'png' | 'jpg' | 'webp';
  mime: string;
} | { ok: false; error: string } {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl.trim()
  );
  if (!match) {
    return { ok: false, error: '仅支持上传 PNG、JPG 或 WebP 格式的收款码原图' };
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 32) {
    return { ok: false, error: '图片文件内容不完整' };
  }
  if (buffer.length > 2 * 1024 * 1024) {
    return { ok: false, error: '收款码图片不能超过 2MB，请直接上传支付宝/微信导出的原图' };
  }

  // Magic byte verification
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (isPng) return { ok: true, buffer, ext: 'png', mime: 'image/png' };
  if (isJpg) return { ok: true, buffer, ext: 'jpg', mime: 'image/jpeg' };
  if (isWebp) return { ok: true, buffer, ext: 'webp', mime: 'image/webp' };

  return { ok: false, error: '图片文件头校验失败，请确认上传的是有效 PNG / JPG / WebP 图片' };
}

export function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

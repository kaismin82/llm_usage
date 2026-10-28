import { getRelayConfig, saveRelayConfig, getSecondaryConfig, saveSecondaryConfig } from '../phone-relay/store';

export interface RelayImport { enabled: boolean; accountLabel?: string; writeToken: string }
export interface SecondaryImport { enabled: boolean; readToken: string }
export interface ImportPayload { relay?: RelayImport; secondary?: SecondaryImport }
export interface ImportResult { ok: boolean; message: string }

const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{20,}$/;

/** Decode `#import=<base64url JSON>`. Returns null for anything else (never throws). */
export function decodeImportHash(hash: string): unknown {
  const match = /^#import=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export function validateImportPayload(value: unknown): { payload: ImportPayload; errors: string[] } {
  const errors: string[] = [];
  const payload: ImportPayload = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { payload, errors: ['payload 형식 오류'] };
  }
  const record = value as Record<string, unknown>;
  const relay = record.relay;
  if (relay !== undefined) {
    if (typeof relay !== 'object' || relay === null || Array.isArray(relay) ||
        typeof (relay as Record<string, unknown>).enabled !== 'boolean' ||
        typeof (relay as Record<string, unknown>).writeToken !== 'string' ||
        !TOKEN_RE.test((relay as Record<string, unknown>).writeToken as string)) {
      errors.push('relay 설정값 오류');
    } else {
      const label = (relay as Record<string, unknown>).accountLabel;
      if (label !== undefined && (typeof label !== 'string' || !LABEL_RE.test(label))) {
        errors.push('계정 라벨 형식 오류');
      } else if (errors.length === 0) {
        payload.relay = {
          enabled: (relay as Record<string, unknown>).enabled as boolean,
          writeToken: (relay as Record<string, unknown>).writeToken as string,
          ...(label === undefined ? {} : { accountLabel: label as string }),
        };
      }
    }
  }
  const secondary = record.secondary;
  if (secondary !== undefined) {
    if (typeof secondary !== 'object' || secondary === null || Array.isArray(secondary) ||
        typeof (secondary as Record<string, unknown>).enabled !== 'boolean' ||
        typeof (secondary as Record<string, unknown>).readToken !== 'string' ||
        !TOKEN_RE.test((secondary as Record<string, unknown>).readToken as string)) {
      errors.push('secondary 설정값 오류');
    } else if (errors.length === 0) {
      payload.secondary = {
        enabled: (secondary as Record<string, unknown>).enabled as boolean,
        readToken: (secondary as Record<string, unknown>).readToken as string,
      };
    }
  }
  return { payload, errors };
}

/** Apply an import link and strip it from the address bar. Token values never appear in messages. */
export async function applyImportHash(hash: string): Promise<ImportResult> {
  const decoded = decodeImportHash(hash);
  if (decoded === null) return { ok: false, message: '가져오기 링크가 올바르지 않습니다' };
  const { payload, errors } = validateImportPayload(decoded);
  if (errors.length > 0) return { ok: false, message: '가져오기 실패: ' + errors.join(', ') };
  if (!payload.relay && !payload.secondary) return { ok: false, message: '가져올 설정이 없습니다' };
  if (payload.relay) {
    const existing = await getRelayConfig();
    await saveRelayConfig({
      enabled: payload.relay.enabled,
      writeToken: payload.relay.writeToken,
      accountLabel: payload.relay.accountLabel ?? existing.accountLabel,
    });
  }
  if (payload.secondary) {
    await saveSecondaryConfig({ enabled: payload.secondary.enabled, readToken: payload.secondary.readToken });
  }
  const parts: string[] = [];
  if (payload.relay) parts.push('휴대폰 동기화(라벨 ' + (payload.relay.accountLabel ?? 'main') + ')');
  if (payload.secondary) parts.push('보조 Claude 계정 표시');
  return { ok: true, message: '설정을 가져왔습니다: ' + parts.join(', ') };
}

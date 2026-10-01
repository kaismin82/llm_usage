import type { UsageWindow } from '../providers/types';
import { isRecord, num } from '../providers/util';
import { CustomConfigError } from './types';
import type { CustomProviderConfig, CustomSnapshot, CustomWindowConfig } from './types';

function readPath(body: unknown, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, key) => {
    if ((isRecord(value) || Array.isArray(value)) && Object.hasOwn(value, key)) {
      return isRecord(value) ? value[key] : value[Number(key)];
    }
    return undefined;
  }, body);
}

function numberAt(body: unknown, path: string): number | undefined {
  if (!path) return undefined;
  const number = num(readPath(body, path));
  if (number === undefined) throw new CustomConfigError(`숫자 필드를 확인해주세요: ${path}`);
  return number;
}

function resetAt(body: unknown, config: CustomWindowConfig): string | null | undefined {
  if (!config.resetPath) return undefined;
  const raw = readPath(body, config.resetPath);
  if (raw === null) return null;
  let date: Date;
  switch (config.resetFormat) {
    case 'iso': date = new Date(typeof raw === 'string' ? raw : Number.NaN); break;
    case 'seconds': date = new Date((num(raw) ?? Number.NaN) * 1000); break;
    case 'milliseconds': date = new Date(num(raw) ?? Number.NaN); break;
    default: {
      const exhaustive: never = config.resetFormat;
      return exhaustive;
    }
  }
  if (!Number.isFinite(date.getTime())) throw new CustomConfigError(`리셋 시각 필드를 확인해주세요: ${config.resetPath}`);
  return date.toISOString();
}

function mapWindow(body: unknown, config: CustomWindowConfig): UsageWindow {
  const usedAmount = numberAt(body, config.usedPath);
  const limitAmount = numberAt(body, config.limitPath);
  const explicitPercent = numberAt(body, config.percentPath);
  const usedPercent = explicitPercent ?? (config.unit === 'percent'
    ? usedAmount
    : usedAmount !== undefined && limitAmount !== undefined && limitAmount > 0
      ? (usedAmount / limitAmount) * 100 : undefined);
  const resetsAt = resetAt(body, config);
  return {
    kind: 'budget', label: config.label, unit: config.unit,
    ...(usedAmount === undefined || config.unit === 'percent' ? {} : { usedAmount }),
    ...(limitAmount === undefined ? {} : { limitAmount }),
    ...(usedPercent === undefined ? {} : { usedPercent }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

export function mapCustomSnapshot(body: unknown, config: CustomProviderConfig, now: Date): CustomSnapshot {
  const windows = config.windows.map((window) => mapWindow(body, window));
  const balance = numberAt(body, config.balancePath);
  return {
    provider: config.id, status: 'ok', windows,
    ...(balance === undefined ? {} : { balance: { amount: balance, unit: config.balanceUnit, label: '잔액' } }),
    fetchedAt: now.toISOString(), attemptedAt: now.toISOString(),
  };
}

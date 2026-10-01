import type { ProviderSnapshot, WindowUnit } from '../providers/types';

export const CUSTOM_UNITS = ['percent', 'usd', 'points', 'calls', 'tokens'] as const;
export const AUTH_MODES = ['none', 'bearer', 'header', 'session'] as const;
export const RESET_FORMATS = ['iso', 'seconds', 'milliseconds'] as const;

export type CustomWindowConfig = {
  readonly label: string;
  readonly unit: WindowUnit;
  readonly usedPath: string;
  readonly limitPath: string;
  readonly percentPath: string;
  readonly resetPath: string;
  readonly resetFormat: typeof RESET_FORMATS[number];
};

export type CustomProviderConfig = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly intervalMin: number;
  readonly endpoint: string;
  readonly authMode: typeof AUTH_MODES[number];
  readonly apiKey: string;
  readonly headerName: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly windows: readonly CustomWindowConfig[];
  readonly balancePath: string;
  readonly balanceUnit: 'usd' | 'points';
};

export type CustomSnapshot = Omit<ProviderSnapshot, 'provider' | 'grants' | 'grantSupport'> & {
  readonly provider: string;
};

export type CustomSchedule = {
  readonly nextDueAt: string | null;
  readonly failures: number;
};

export type CustomMessage =
  | { readonly type: 'custom-refresh'; readonly id?: string }
  | { readonly type: 'custom-settings-changed'; readonly id: string };

export class CustomConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomConfigError';
  }
}

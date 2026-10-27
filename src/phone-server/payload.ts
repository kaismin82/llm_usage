import { z } from 'zod';

const text = z.string().max(200);
const time = z.iso.datetime({ offset: true });
const observationTime = z.union([time, z.literal('')]);
const optionalTime = time.nullable().optional();
const amount = z.number();

const windowSchema = z.strictObject({
  kind: text, label: text, unit: text,
  usedPercent: amount.optional(), usedAmount: amount.optional(),
  limitAmount: amount.optional(), resetsAt: optionalTime,
  windowSeconds: amount.nonnegative().optional(),
  periodTz: text.optional(), partial: z.boolean().optional(),
});
const grantSchema = z.strictObject({
  scope: text, remaining: amount, status: text,
  startsAt: optionalTime, expiresAt: optionalTime, countOnly: z.boolean().optional(),
});

export const phonePayloadSchema = z.strictObject({
  version: z.literal(1),
  sentAt: time,
  providers: z.array(z.strictObject({
    id: text.min(1), name: text.min(1), status: text,
    fetchedAt: observationTime, attemptedAt: observationTime,
    windows: z.array(windowSchema).max(100),
    grants: z.array(grantSchema).max(100),
    grantSupport: text.optional(),
    extraCredits: z.strictObject({
      unit: z.enum(['usd', 'credits']), balanceAmount: amount.optional(),
      unlimited: z.boolean().optional(), isEnabled: z.boolean().optional(),
    }).optional(),
    balance: z.strictObject({
      amount, unit: z.enum(['usd', 'points']), limit: amount.optional(),
      label: text.optional(), resetsAt: optionalTime,
    }).optional(),
  })).max(100).refine((providers) =>
    new Set(providers.map((provider) => provider.id)).size === providers.length),
});

export type PhonePayload = z.infer<typeof phonePayloadSchema>;
export const receiptSchema = z.strictObject({ receivedAt: time, data: phonePayloadSchema });
export type PhoneReceipt = z.infer<typeof receiptSchema>;

import { z } from 'zod';

export const EVENT_TYPES = [
  'lab.started',
  'step.completed',
  'lab.error',
  'lab.timeout',
  'lab.completed',
] as const;

const id = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(1, `${name} must not be empty`)
    .max(128, `${name} must be at most 128 characters`)
    .regex(/^[A-Za-z0-9_.:\-@]+$/, `${name} may only contain letters, digits and _ . : - @`);

const MAX_FUTURE_MS = 24 * 3600 * 1000;

export const ingestSchema = z.strictObject({
  type: z.enum(EVENT_TYPES, {
    error: `type must be one of: ${EVENT_TYPES.join(', ')}`,
  }),
  tenantId: id('tenantId'),
  labId: id('labId'),
  learnerId: id('learnerId'),
  step: z.string().min(1, 'step must not be empty').max(200),
  message: z.string().max(2000, 'message must be at most 2000 characters'),
  occurredAt: z.iso
    .datetime({ offset: true, error: 'occurredAt must be an ISO-8601 timestamp' })
    .refine((v) => Date.parse(v) <= Date.now() + MAX_FUTURE_MS, 'occurredAt is too far in the future'),
  idempotencyKey: z
    .string({ error: 'idempotencyKey is required' })
    .min(8, 'idempotencyKey must be at least 8 characters')
    .max(200)
    .refine((v) => !v.startsWith('alert:'), "idempotencyKey must not start with 'alert:' (reserved for system alerts)"),
});
export type IngestEvent = z.infer<typeof ingestSchema>;

/** The wire/DB shape delivered to clients. */
export interface StoredEvent {
  tenantId: string;
  seq: number;
  type: string; // EVENT_TYPES | 'instructor.alert'
  labId: string;
  learnerId: string | null;
  step: string | null;
  message: string | null;
  occurredAt: string;
  idempotencyKey: string;
}

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
}

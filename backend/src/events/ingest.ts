import type { Redis } from 'ioredis';
import { AlertDetector } from './alerts';
import { ALERT_TYPE, EventStore, payloadHash } from './store';
import type { IngestEvent, StoredEvent } from './schema';

export const EVENTS_CHANNEL = 'lp:events';

export class IdempotencyConflict extends Error {}

export interface IngestResult {
  event: StoredEvent;
  duplicate: boolean;
  /** false => persisted but the realtime publish failed; clients recover through catch-up */
  published: boolean;
  alert?: StoredEvent;
}

export class IngestService {
  constructor(
    private readonly store: EventStore,
    private readonly publisher: Redis,
    private readonly alerts: AlertDetector,
  ) {}

  async ingest(input: IngestEvent): Promise<IngestResult> {
    const hash = payloadHash(input);

    const existing = await this.store.findByKey(input.tenantId, input.idempotencyKey);
    if (existing) return this.replayOf(existing, hash);

    return this.store.withTenantLock(input.tenantId, async (client) => {
      // re-check under the lock: a concurrent POST with the same key may have just won
      const raced = await this.store.findByKey(input.tenantId, input.idempotencyKey, client);
      if (raced) return this.replayOf(raced, hash);

      // 1) persist first
      const event = await this.store.append(client, {
        tenantId: input.tenantId,
        type: input.type,
        labId: input.labId,
        learnerId: input.learnerId,
        step: input.step,
        message: input.message,
        occurredAt: new Date(input.occurredAt).toISOString(),
        idempotencyKey: input.idempotencyKey,
        hash,
      });

      // 2) stateful alert (only for genuinely new events, so duplicate POSTs never double count)
      let alert: StoredEvent | undefined;
      if (input.type === 'lab.error') {
        let claimed = false;
        try {
          const count = await this.alerts.recordError(input.tenantId, input.learnerId, input.idempotencyKey);
          if (count > 0) {
            claimed = true;
            alert = await this.store.append(client, {
              tenantId: input.tenantId,
              type: ALERT_TYPE,
              labId: input.labId,
              learnerId: input.learnerId,
              step: input.step,
              message: `${input.learnerId} raised ${count} lab.error events within the alert window`,
              occurredAt: new Date().toISOString(),
              idempotencyKey: `alert:${input.learnerId}:${event.seq}`,
              hash: `alert:${event.seq}`,
            });
          }
        } catch (err) {
          // fail open: the event is durable; alerting degrades while Redis is unavailable
          console.error('[alert] evaluation failed', (err as Error).message);
          // we claimed the episode but never stored the alert: hand the claim back so a later error can alert
          if (claimed) await this.alerts.releaseEpisode(input.tenantId, input.learnerId).catch(() => undefined);
        }
      }

      // 3) deliver, still under the lock so publish order == seq order
      let published = true;
      try {
        await this.publish(event);
        if (alert) await this.publish(alert);
      } catch (err) {
        published = false;
        console.error('[publish] failed, relying on client catch-up', (err as Error).message);
      }
      return { event, duplicate: false, published, alert };
    });
  }

  private replayOf(existing: { event: StoredEvent; hash: string }, hash: string): IngestResult {
    if (existing.hash !== hash) {
      throw new IdempotencyConflict('idempotencyKey was already used with a different payload');
    }
    return { event: existing.event, duplicate: true, published: true };
  }

  private async publish(e: StoredEvent) {
    await this.publisher.publish(EVENTS_CHANNEL, JSON.stringify(e));
  }
}

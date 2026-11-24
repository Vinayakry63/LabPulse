# LabPulse design note

## Key decisions (ADRs)

**1. Per-tenant gap-free sequence is the cursor.** A global `BIGSERIAL` is unsafe: transactions can commit out of order, so a client could see seq 11, store cursor=11 and never receive 10. Each tenant has a counter row (`tenant_seq`) and every write runs under a per-tenant advisory lock, so seq order = commit order. Cost: one tenant's writes are serialised (~400-500/s measured); tenants scale independently.

**2. Publish inside the lock, after COMMIT.** Concurrent POSTs for a tenant cannot announce out of order, so every instance sees a tenant's events in seq order. The per-socket rule "deliver only if `seq > lastSent`" is then both a duplicate filter and an ordering guarantee. DB-first holds: an event is durable before it is announced.

**3. Redis Pub/Sub is a hint, Postgres is the truth.** One channel; every instance receives every event and filters in memory by tenant and role (`canSee`). Pub/Sub is fire-and-forget, so no correctness depends on it.

**4. Race-free catch-up.** Register the socket for live events first (buffering), page the DB from the cursor, then drain the buffer and go live in one synchronous step. An event is in the DB read, or announced after registration, or both; `lastSent` removes the overlap.
- **4b. Gap detection + sweep.** `PUBLISH` follows `COMMIT`, so a crash or Redis error between them leaves an event that is durable but never announced. Because the cursor is the highest seq seen, skipping 10 then delivering 11 would hide 10 forever, even across reconnects (a probe confirmed this in an earlier version). Seqs are gap-free per tenant, so each instance tracks the last seq announced per tenant: N+2 right after N proves a hole and re-syncs that tenant's sockets from Postgres. A 10 s sweep (`tenant_seq.last_seq` vs announced) catches a lost *last* event.
- **4c. Writers queue in memory, not on connections.** Waiting inside `pg_advisory_lock` pinned a pooled connection per waiter, so one hot tenant starved all others (measured: quiet tenant 14 ms -> p50 ~910 ms). Each instance now queues a tenant's writers in a bounded FIFO (overflow -> `503 tenant_busy`) and lets two proceed: one active, one already waiting on the lock so hand-over is free (depth 1 cost 10-35% throughput; depth 2 recovered it).

**5. Alerts: one atomic Lua script.** Sorted-set sliding window per (tenant, learner); the script trims, records, counts and claims the episode with `SET NX`. An episode ends when the window is next seen below threshold, so a persistent failure alerts once and a recovered learner can alert again. Duplicate POSTs never reach it. The alert is stored as an `instructor.alert` event, so it has a seq and catch-up replays it; instructors receive it in the ordered `events` stream and also under the dedicated `instructor.alert` socket event, learners never do. If the alert row cannot be stored, the claim is released. Client idempotency keys starting `alert:` are reserved.

**6. Assistant safety.** A similarity threshold gates the model: below it, the fixed phrase is returned with no LLM call. The events tool takes **no identity arguments**; tenant and learner come from the verified JWT. Event text is attacker-influenced, so it is control-char-stripped, `<>`-escaped, length-capped, JSON-encoded and fenced as `<untrusted_lab_events>`, and the prompt says it is data. A `LLMProvider` interface keeps the vendor swappable and gives an offline mock; a spell-fix step runs before retrieval on OpenAI.

## Failure modes

| Failure | Behaviour | Status |
|---|---|---|
| **Duplicate POSTs** | Same key + payload -> `200 duplicate` with the original seq; different payload -> `409`; races closed by a re-check under the lock plus a unique index; never double-counted for alerts | tested |
| **Redis down** | Publisher fails fast (no offline queue, 2 s timeout) so it never stalls a tenant lock. Event committed, `201 delivered:false`; alerting fails open. On reconnect each instance re-syncs its sockets from the DB | fault-injected 11/11 |
| **Slow / frozen Postgres** | 3 s pool wait, 5 s client-side `query_timeout` (a frozen DB never answers, so a server timeout is not enough); timed-out connections are destroyed so their lock is released; `503 Retry-After`, same-key retry is safe | fault-injected 6/6 (found and fixed a hang) |
| **Committed but never announced** | Gap detection or the 10 s sweep re-syncs affected sockets in order | tested |
| **One tenant floods writes** | Bounded per-tenant queue; other tenants keep their latency | tested + measured |
| **LLM timeout / error** | 20 s deadline, typed `error` event, client abort cancels upstream; the not-covered path needs no LLM; spell-fix falls back to the original text | mock + fake-OpenAI server |
| **Instance dies / client reconnects elsewhere** | Resume from the highest rendered seq on any instance (WebSocket-only, so no sticky sessions) | tested |
| **Slow consumer / expired token** | Backlog or buffer over a cap -> disconnect and recover from the cursor; sockets close at JWT expiry | tested |

Known gaps: an alert whose errors all occur during a Redis outage is not raised afterwards (fix: rebuild the window from Postgres); a lost announcement is repaired within one sweep (10 s), not instantly (an outbox relay would be immediate); tokens cannot be revoked before expiry.

## Scaling to 50,000 concurrent connections

Today every instance receives every event (O(instances x rate)) and scans a tenant's sockets, which is fine here but not at 50k.

1. **Scale connections out.** One Node process holds ~10-20k idle sockets: run ~5-10 stateless instances (raise `ulimit -n` and nginx `worker_connections`; WebSocket-only needs no stickiness). Autoscale on connections per instance, not CPU.
2. **Shard the bus by tenant.** Publish to `lp:t:{tenantId}`; each instance subscribes only for tenants with a local socket (ref-counted), or use Redis 7 sharded Pub/Sub.
3. **Index sockets** by (tenant, learner) so a learner event touches one socket; coalesce emits (~50 ms) for dashboards.
4. **Reconnect storms.** Client backoff has jitter; cap concurrent catch-ups per instance; serve first-connect snapshots from a cached projection instead of a 5k-event tail.
5. **Write path.** The per-tenant lock caps a hot tenant. Beyond that use a partitioned log (Redis Streams / Kafka) keyed by tenant with one sequencing consumer, Postgres as system of record via batched inserts, read replicas for catch-up, time-partitioned `events`.
6. **Operate it.** Metrics for publish lag, sweep repairs, catch-up duration, socket backlog and drops; per-tenant rate limits.

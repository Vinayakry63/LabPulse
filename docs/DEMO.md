# LabPulse: demo guide and Q&A preparation

For the 60-minute Round 2 session: a 20-25 minute presentation with a live demo, then Q&A and a code walkthrough.

## Before the call (10 minutes)

- [ ] Docker Desktop running; `docker compose up -d --build`; `docker compose ps` shows 6 services, backends `healthy`.
- [ ] `.env` has `OPENAI_API_KEY`; `docker compose logs init | tail -3` shows `embeddings=openai:...` (not `mock`).
- [ ] Ask the assistant one question yourself to confirm the key works and credits remain.
- [ ] Three browser windows ready at http://localhost:5173: *Acme - Instructor*, *Globex - Instructor*, *Acme - Learner 1*.
- [ ] A terminal in `backend/` with `npm install` done, ready to run `npm run simulate`, and a second terminal at the repo root.
- [ ] `README.md` open on the architecture diagram; `docs/DESIGN.md` open for the failure-mode table.
- [ ] Fallback if the key or network fails: the mock provider still demonstrates retrieval, citations, refusal and the tool flow. Say so openly.

## Presentation plan (about 22 minutes)

| Time | Segment | What to say and show |
|---|---|---|
| 0-2 | Problem | Thousands of learners across tenants; instructors need live visibility, learners need timely help. LabPulse is the thin slice: ingest, deliver, alert, assist. |
| 2-6 | Architecture | README diagram. Write path: validate, per-tenant lock, persist, announce over Redis. Read path: any instance serves any socket; cursor catch-up. Stress the two ideas: **Postgres is the truth, Redis is only a hint**, and **a per-tenant gap-free sequence is the cursor**. |
| 6-12 | Live demo | Steps below. |
| 12-16 | Reliability | The two bugs the audit found and fixed (below), the fault-injection results, the load numbers. This is the strongest part of the submission. |
| 16-20 | AI assistant | RAG flow, the confidence gate, the tool, the safety measures, the evaluation and its limits. |
| 20-23 | Trade-offs and next steps | Serial section per tenant, fail-open alerts, mock vs real model, what a week more buys. |

### Live demo script (6 minutes)

1. **Isolation.** Show Acme and Globex instructor windows side by side, plus the Acme learner. Run `npm run simulate`. Each window fills with only its own tenant's learners; the learner window shows one row and no alerts panel.
2. **Alert.** Wait for a learner to raise errors (or `curl` three `lab.error` events from the README). One alert appears with the unread badge and the tab title `(1) LabPulse`; click the bell to clear it. Mention it fires once per episode even with two backends.
3. **Instances.** Point at `Live - backend-1/2` in the header and at the simulator output `handled by backend-X`: the POST and the socket are often on different instances, and Redis bridges them.
4. **Reconnect.** Click **Simulate drop**, let the simulator keep running, watch *Reconnecting* then *Live*, and the counter `cursor N` jump with no duplicates.
5. **Out-of-order safety.** Mention (do not demo) the unit test that feeds the view reversed and shuffled events and gets an identical result.
6. **Assistant.** In the learner window click *What are the naming rules for a storage account name?* (cited answer), then *What is the capital of France?* (exact refusal), then *Why did my deployment step fail?* (the "used your lab events" tag and the real error text).
7. **Fault tolerance (optional, 90 s).** `docker compose stop redis`, POST an event (it still succeeds with `delivered:false`), `docker compose start redis`, and the dashboard fills in the missed events.

## The three stories worth telling

1. **A bug my own docs hid.** A committed-but-never-announced event was skipped by connected clients and, because the cursor is the highest sequence seen, never recovered even after a reconnect. An independent review suggested it; a probe proved it; per-tenant gap detection plus a 10-second sweep fixed it, with tests that fail without the fix.
2. **Noisy neighbour.** Waiting for the tenant lock pinned a pooled connection per waiter, so one flooding tenant took a quiet tenant from 14 ms to about 910 ms. Fixed with an in-memory per-tenant queue; the first version cost throughput, so I A/B-benchmarked it and tuned the pipeline depth to 2.
3. **Frozen database.** A server-side `statement_timeout` cannot fire when Postgres never answers, so POSTs hung. Fixed with a client-side query timeout and by destroying stuck connections; now `503 + Retry-After` in about 5 s and a same-key retry is safe.

## What is reused versus new

The brief says this builds on patterns already shipped (Socket.IO with Redis fan-out, DB-first persistence, RAG with vector search and tool routing). Be ready to say plainly what is new here: **multi-tenancy** (token-scoped delivery and SQL, isolation tests), **delivery guarantees** (per-tenant sequence, cursor catch-up, gap detection), **stateful alerting** (Redis sliding window, exactly-once across instances), and **backend-to-AI integration** (a tenant-safe tool reading Part A's data, untrusted-input handling). Adjust this paragraph to match your earlier projects.

## Code walkthrough map

| Topic | File and what to point at |
|---|---|
| Ordering and the lock | `backend/src/events/store.ts`: `withTenantLock`, `enterLocalQueue`, `append` (counter upsert + insert in one transaction) |
| Persist then publish | `backend/src/events/ingest.ts`: idempotency re-check under the lock, persist, alert, publish |
| Catch-up without races | `backend/src/realtime/hub.ts`: `onConnection`, `catchUp` (register, page, drain), `dispatch` gap branch, `sweep` |
| Isolation | `store.ts` `canSee`, the SQL filters in `fetchAfter`; tests in `isolation.test.ts` |
| Alert rule | `backend/src/events/alerts.ts`: the Lua script (trim, add, count, `SET NX`) |
| Sequence-ordered UI | `frontend/src/lib/store.ts` (`mergeEvents`, `fold`) and `store.test.ts` |
| RAG | `assistant/chunker.ts`, `guide.ts` (`retrieve`), `orchestrator.ts` (gate, tool loop) |
| Tool safety | `assistant/tools.ts`: `executeTool` takes identity from claims; `sanitizeUntrusted` |

## Likely questions and straight answers

**Why not a global `BIGSERIAL` as the cursor?** Transactions can commit out of order, so a client could see 11 before 10 commits and never get 10. A per-tenant counter updated under a per-tenant lock makes sequence order equal commit order.

**Why publish while holding the lock?** So two POSTs for a tenant cannot announce out of order; then "deliver only if seq > lastSent" is both a duplicate filter and an ordering guarantee. The event is already committed, so durability is unaffected.

**Is delivery at-least-once or exactly-once?** Effectively exactly-once per connection: the server dedupes with `lastSent`, and the client dedupes by sequence. Producers retrying with the same idempotency key also create one row. The true guarantee is at-least-once with idempotent handling at both ends.

**What if Redis dies?** Writes keep succeeding (`delivered:false`); the publisher fails fast so it never holds a tenant lock. When Redis returns, each instance re-syncs its sockets from Postgres. Alerts fail open: three errors entirely inside an outage are not alerted afterwards, and I list that as a known gap.

**What if the instance crashes between COMMIT and PUBLISH?** The event is durable but unannounced. The next event's sequence gap, or the 10-second sweep, re-syncs affected sockets. An outbox relay would make it immediate.

**How would you reach 50,000 connections?** More stateless instances (10-20k sockets each), shard the Pub/Sub channel by tenant so instances only receive tenants they host, index sockets by learner, cap concurrent catch-ups for reconnect storms, and replace the per-tenant lock with a partitioned log for hot tenants. Details in the design note.

**Why pgvector, not Pinecone?** One fewer service, one backup, one connection pool, and the data fits comfortably (81 chunks). I would revisit at millions of chunks or if search needed independent scaling.

**How do you stop prompt injection through event text?** The model never chooses identity (the tool has no identity arguments), event text is sanitised, escaped, capped and fenced as data, and the system prompt says never to follow it. This lowers the risk; it does not make a model immune, so the blast radius is also limited: the tool can only read the caller's own errors.

**How do you know the assistant is grounded?** A similarity gate refuses when retrieval is weak; the prompt restricts answers to the excerpts and requires citations; the eval checks citations and that the answer's words come from the retrieved text. That check is a proxy; an LLM judge would be stronger. The numbers I report come from the offline mock, so they validate retrieval and orchestration, not model quality.

**What did you skip and why?** Real auth (demo tokens), rate limiting, an outbox, conversation memory and hybrid search. I prioritised delivery correctness and isolation because they are 50% of the rubric between them, then the assistant's grounding and safety. Everything skipped is listed in the README.

**What would you do differently with another week?** The list in the README: search the guide with the error text, hybrid search and re-ranking, an outbox, fault injection under load, real auth.

**Did you use AI assistance?** The brief allows it. Be ready to explain every part, especially the ordering, catch-up and tool-safety code listed above.

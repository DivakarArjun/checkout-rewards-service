# Engineering Decisions

## Time spent

Approximate implementation time: **4–5 hours** (replace with actual time before submission). This is an exercise implementation, not a production-readiness claim.

## Invariants

1. One order per cart (`Order.cartId` unique); a checked-out cart cannot be edited or checked out again.
2. One committed order per idempotency key (`Order.idempotencyKey` unique).
3. Inventory must remain nonnegative and is decremented in the checkout transaction.
4. A coupon milestone can have at most one coupon (`milestoneOrderCount` unique).
5. A coupon is claimed once by a successful order (`Coupon.orderId` unique and status transition).
6. Order item name, unit price, quantity, line total, and order totals are snapshots.
7. Reports are derived from committed orders/items/coupons and are read-only.
8. Money is integer minor units; net total cannot be negative.

## Decision: TypeScript, Express, Prisma

**Context:** The assignment needs a small, easy-to-run HTTP service with a clear domain boundary.

**Options considered:** NestJS, Fastify, raw SQL, in-memory state.

**Choice:** Express with TypeScript, Prisma, SQLite, and Vitest/Supertest.

**Why:** Familiar tooling, explicit routes, typed persistence access, and repeatable local setup.

**Consequences:** Prisma abstracts routine queries but does not remove the need to understand database transactions, constraints, or isolation. Production database behavior must be validated against the chosen engine.

## Decision: Database transaction boundary

**Context:** Order creation, stock decrement, cart closure, and coupon redemption must succeed or fail together.

**Options considered:** process-local mutex, independent writes, SQLite transaction, PostgreSQL row locks.

**Choice:** Prisma interactive transaction for checkout and coupon generation; unique constraints and conditional inventory updates provide additional defenses.

**Why:** Failed work rolls back and durable constraints survive process restarts. The conditional inventory update only succeeds where current inventory is at least the requested quantity.

**Consequences:** SQLite serializes writes at database level and is suitable for a local evaluation, but has limited write concurrency. For production, use PostgreSQL, row-level locks or conditional updates, explicit isolation/retry policy, and test races on the real target database. Avoid holding database transactions open during external payment calls.

## Decision: Idempotency

**Context:** The client may time out after the order commits.

**Options considered:** deduplicate by cart alone; client idempotency key; compensate duplicate orders.

**Choice:** Require `Idempotency-Key`, persist it with a unique constraint, and return the original order when the same key is retried for the same cart.

**Why:** It identifies a logical client operation and survives restarts.

**Consequences:** Keys are globally scoped and request bodies are not fingerprinted in this exercise. Production should scope keys to customer/tenant, store a request hash and replayable response, define retention, and test simultaneous same-key requests. Database uniqueness is still the final constraint; a production API should translate uniqueness/serialization races into a clean replay or conflict response.

## Decision: Price and inventory changes

**Context:** Prices and stock can change between cart edits and checkout.

**Options considered:** reserve price and stock on cart edit; reserve only stock; use current catalog values.

**Choice:** Use current price and available inventory at checkout; cart reads also show current prices. No inventory reservation is made for open carts.

**Why:** Avoids stale quotes and long-lived stock locks.

**Consequences:** Cart totals can change. A production UI should disclose this policy; expiring reservations can be added if needed.

## Decision: Coupon semantics

**Context:** The prompt does not specify whether coupons are automatically created or whether missed milestones are recovered.

**Options considered:** auto-issue within checkout; admin-only issuance; a background worker that backfills.

**Choice:** Admin generates only when the current successful-order count is a positive multiple of `n`. A unique milestone constraint prevents duplicate issuance, and repeated calls return the existing coupon. Skipped milestones are not backfilled.

**Why:** Makes the required admin action explicit and deterministic.

**Consequences:** Operations must call the generation endpoint at the eligible milestone. A production alternative is transactional automatic issuance or a durable outbox worker that recovers all missed milestones.

**Redemption:** Coupon is a percent-off discount and may be used by any caller until one successful checkout claims it. Claim, inventory decrement, order creation, and cart closure are in one transaction; rollback preserves coupon availability after failure. UUID-derived random codes reduce guessing risk but are not a substitute for authorization.

## Decision: Money and rounding

**Context:** Floating-point can introduce currency rounding errors.

**Options considered:** floating-point; Decimal arithmetic; integer minor units.

**Choice:** Integer cents throughout persistence and calculations. API serializes to decimal strings. Discount rounds half-up to the nearest cent using integer arithmetic: `floor((grossCents * percent + 50) / 100)`, then caps at gross.

**Why:** Exact arithmetic for the assumed two-decimal currency.

**Consequences:** Currency is implicit. Production should persist ISO currency codes and define minor-unit/rounding rules per currency. Tax, shipping, and per-line discount allocation are out of scope.

## Decision: Payment abstraction

**Context:** No real payment integration is required.

**Options considered:** gateway integration; fake payment; payment interface with failure simulation.

**Choice:** A committed checkout is treated as successful payment. No external side effect occurs inside the transaction.

**Why:** Keeps the system self-contained and avoids distributed transaction ambiguity.

**Consequences:** Real payment needs gateway idempotency, authorization/capture, timeout reconciliation, refunds/voids, and a reservation/state-machine or saga/outbox approach.

## Decision: Errors and reporting

**Context:** Clients need stable error classes, and report numbers must reconcile.

**Choice:** `ApiError` maps domain failures to HTTP status and stable codes; Zod errors return `422`. Reports aggregate committed order and coupon tables instead of mutating counters.

**Why:** Errors can be handled predictably; ledger-derived reporting avoids counter drift.

**Consequences:** Framework/database errors need more complete normalization. Aggregates become expensive as history grows; production can add materialized views and reconcile them against the order ledger.

## Implemented vs deferred

Implemented: seeded catalog, cart CRUD, checkout, idempotency, inventory checks/decrements, order snapshots, coupon generation/redemption, report, focused automated tests.

Deferred: auth/roles, product administration, payment provider, tax/shipping/refunds, inventory reservation, request hash for idempotency, robust retry policy for all database races, rate limiting, structured logs/metrics/tracing, Docker/CI, and production PostgreSQL migrations.

## Multi-instance evolution

SQLite works for local evaluation. Multiple application processes on one SQLite file still rely on database locking, but contention limits throughput and multi-host storage is not an appropriate deployment strategy. Move to PostgreSQL for multi-instance service deployment, keep unique/check constraints, perform stock decrements conditionally inside transactions, define isolation and retry handling, and use a payment saga/outbox for external effects. Add load tests and telemetry for lock waits, conflicts, idempotency replays, and coupon contention.

## AI use

AI assistance helped outline the API, invariants, and edge cases. I reviewed the generated approach rather than treating it as correct by default. In particular, coupon claim, inventory decrement, order insert, and cart closure must be one atomic transaction; otherwise a failed checkout could consume a coupon or stock. Before submission, replace this section with an honest account of your actual tool use and one specific change you personally reviewed or made. Do not claim tests passed unless you ran them locally.

## First two hours of follow-up

1. Run and extend the tests against the exact SQLite/Prisma versions in the lockfile.
2. Add concurrent same-idempotency-key tests and verify stable response behavior.
3. Normalize Prisma uniqueness/locking failures into documented domain errors.
4. Add request fingerprinting for idempotency.
5. Add CI, Docker, observability, and PostgreSQL integration tests.

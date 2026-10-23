# Checkout and Rewards Service (TypeScript)

Node.js + TypeScript + Express + Prisma + SQLite. Focus: transactional checkout, idempotency, inventory correctness, single-use rewards, and reconciled reporting.

## Requirements

- Node.js 20+ and npm
- No external services or credentials

## Setup and run

```bash
npm install
cp .env.example .env
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
```

API listens at `http://localhost:3000`. Seeded products include a limited-inventory mug (3 units). Set `REWARD_EVERY_N_ORDERS` and `COUPON_PERCENT` in `.env` before starting. Default values are 5 and 10. Do not change reward configuration while existing data is in use.

Build and test:

```bash
npm test
npm run build
npm start
```

## Project structure

```text
src/
├── app.ts                 # Express composition and middleware
├── server.ts              # Process entry point
├── routes/                # HTTP request/response handling
├── services/              # Cart, checkout, and rewards business rules
├── errors/                # Domain errors and error middleware
└── lib/                   # Shared Prisma client
prisma/
├── schema.prisma
└── seed.ts
tests/
└── service.test.ts
DECISIONS.md
README.md
```

## API

Money is returned as decimal strings (e.g. `"12.34"`), stored internally as integer cents. All `/admin/*` routes are administrative; authentication/authorization is not implemented.

| Method / path | Request | Success | Important errors |
|---|---|---|---|
| `GET /health` | — | `200` status | — |
| `GET /products` | — | `200` products, price, inventory | — |
| `POST /carts` | — | `201` empty cart | — |
| `GET /carts/:cartId` | — | `200` cart, current prices and subtotal | `404 CART_NOT_FOUND` |
| `POST /carts/:cartId/items` | `{"productId":"pasta","quantity":2}` | `200` cart; quantity adds to existing quantity | `404 PRODUCT_NOT_FOUND`, `409 CART_CLOSED`, `422` invalid quantity |
| `PUT /carts/:cartId/items/:productId` | `{"quantity":3}` | `200` updated cart | `404 CART_ITEM_NOT_FOUND`, `409 CART_CLOSED` |
| `DELETE /carts/:cartId/items/:productId` | — | `204` | `404 CART_ITEM_NOT_FOUND`, `409 CART_CLOSED` |
| `POST /carts/:cartId/checkout` | `{"couponCode":"REWARD-..."}` or `{}` plus required `Idempotency-Key` header | `201` immutable order snapshot | `400 IDEMPOTENCY_KEY_REQUIRED`, `404 CART_NOT_FOUND`, `409 CART_CLOSED`, `409 INSUFFICIENT_INVENTORY`, `409 COUPON_ALREADY_REDEEMED`, `422 EMPTY_CART`, `422 INVALID_COUPON` |
| `GET /orders/:orderId` | — | `200` order snapshot | `404 ORDER_NOT_FOUND` |
| `POST /admin/coupons/generate` | — | `201` coupon; repeats return same coupon at milestone | `409 MILESTONE_NOT_ELIGIBLE` |
| `GET /admin/report` | — | `200` aggregates | — |

Errors are `{ "error": { "code": "...", "message": "...", "details": {} } }`. Zod validation errors return `422 VALIDATION_ERROR`.

## Example checkout

```bash
curl -s -X POST localhost:3000/carts
# Copy the returned id into CART_ID
curl -s -X POST localhost:3000/carts/$CART_ID/items \
  -H 'Content-Type: application/json' \
  -d '{"productId":"limited-mug","quantity":1}'
curl -i -X POST localhost:3000/carts/$CART_ID/checkout \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-demo-001' -d '{}'
curl -s localhost:3000/admin/report
```

## Business semantics

- Cart display and checkout use current product prices. Stock is not reserved while editing the cart.
- Checkout requires an idempotency key. Same key + same cart returns the original order; same key + different cart is `409 IDEMPOTENCY_KEY_REUSED`. A different key on a checked-out cart is `409 CART_CLOSED`.
- A checkout commit represents successful payment; no external payment integration exists.
- Discount is percentage-off gross item subtotal, rounded half-up to the nearest cent and capped at gross.
- Admin generation is eligible only when successful order count is a positive multiple of `n`; it generates at most one coupon for that milestone. Missed milestones are not backfilled.

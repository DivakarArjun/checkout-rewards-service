import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";

const db = new PrismaClient();
const app = createApp();

async function reset() {
  await db.orderItem.deleteMany();
  await db.coupon.deleteMany();
  await db.order.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.product.deleteMany();
  await db.product.createMany({ data: [
    { id: "pasta", name: "Pasta", priceCents: 399, inventory: 100 },
    { id: "coffee", name: "Coffee", priceCents: 299, inventory: 100 },
    { id: "tea", name: "Tea", priceCents: 199, inventory: 100 },
    { id: "limited-mug", name: "Limited Mug", priceCents: 1599, inventory: 3 },
    { id: "chocolate", name: "Chocolate", priceCents: 249, inventory: 50 }
  ] });
}
async function makeCart(productId = "pasta", quantity = 1) {
  const cart = await request(app).post("/carts").expect(201);
  await request(app).post(`/carts/${cart.body.id}/items`).send({ productId, quantity }).expect(200);
  return cart.body.id as string;
}

beforeAll(async () => { await db.$connect(); });
beforeEach(async () => {
  process.env.REWARD_EVERY_N_ORDERS = "2";
  process.env.COUPON_PERCENT = "10";
  await reset();
});
afterAll(async () => { await db.$disconnect(); });

describe("checkout invariants", () => {
  it("returns the original order on idempotent retry and reconciles report", async () => {
    const cartId = await makeCart("pasta", 2);
    const first = await request(app).post(`/carts/${cartId}/checkout`).set("Idempotency-Key", "retry-1").send({}).expect(201);
    const retry = await request(app).post(`/carts/${cartId}/checkout`).set("Idempotency-Key", "retry-1").send({}).expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(first.body.grossTotal).toBe("7.98");
    const report = await request(app).get("/admin/report").expect(200);
    expect(report.body.successfullyPlacedOrders).toBe(1);
    expect(report.body.grossRevenue).toBe("7.98");
    expect(report.body.purchasedQuantityByProduct[0].quantity).toBe(2);
  });

  it("only allows one of two competing checkouts to buy limited stock", async () => {
    const a = await makeCart("limited-mug", 2);
    const b = await makeCart("limited-mug", 2);
    const results = await Promise.all([
      request(app).post(`/carts/${a}/checkout`).set("Idempotency-Key", "stock-a").send({}),
      request(app).post(`/carts/${b}/checkout`).set("Idempotency-Key", "stock-b").send({})
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUniqueOrThrow({ where: { id: "limited-mug" } })).inventory).toBe(1);
    expect((await db.order.count())).toBe(1);
  });

  it("coupon milestone is idempotent and concurrent redemption has one winner", async () => {
    for (const [productId, key] of [["tea", "order-1"], ["pasta", "order-2"]] as const) {
      const cartId = await makeCart(productId, 1);
      await request(app).post(`/carts/${cartId}/checkout`).set("Idempotency-Key", key).send({}).expect(201);
    }
    const coupon = await request(app).post("/admin/coupons/generate").expect(201);
    const repeated = await request(app).post("/admin/coupons/generate").expect(201);
    expect(repeated.body.code).toBe(coupon.body.code);
    const a = await makeCart("coffee", 1);
    const b = await makeCart("chocolate", 1);
    const results = await Promise.all([
      request(app).post(`/carts/${a}/checkout`).set("Idempotency-Key", "coupon-a").send({ couponCode: coupon.body.code }),
      request(app).post(`/carts/${b}/checkout`).set("Idempotency-Key", "coupon-b").send({ couponCode: coupon.body.code })
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const report = (await request(app).get("/admin/report")).body;
    expect(report.coupons).toEqual({ generated: 1, available: 0, redeemed: 1 });
    expect(Number(report.grossRevenue)).toBeCloseTo(Number(report.netRevenue) + Number(report.discountsGranted), 2);
  });

  it("failed checkout leaves cart open and stock unchanged", async () => {
    const cartId = await makeCart("limited-mug", 1);
    await request(app).post(`/carts/${cartId}/checkout`).set("Idempotency-Key", "bad-coupon").send({ couponCode: "NOPE" }).expect(422);
    expect((await request(app).get(`/carts/${cartId}`)).body.status).toBe("open");
    expect((await db.product.findUniqueOrThrow({ where: { id: "limited-mug" } })).inventory).toBe(3);
    expect(await db.order.count()).toBe(0);
  });
});

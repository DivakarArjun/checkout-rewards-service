import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { ApiError } from "../errors/api-error";
import { money } from "./cart.service";

function config() {
  const every = Number(process.env.REWARD_EVERY_N_ORDERS ?? 5);
  const percent = Number(process.env.COUPON_PERCENT ?? 10);
  if (!Number.isInteger(every) || every < 1 || !Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new ApiError(500, "INVALID_REWARD_CONFIGURATION", "Reward configuration is invalid");
  }
  return { every, percent };
}

export async function generateCoupon(db: PrismaClient) {
  const { every, percent } = config();
  return db.$transaction(async tx => {
    const count = await tx.order.count();
    if (!count || count % every !== 0) {
      throw new ApiError(409, "MILESTONE_NOT_ELIGIBLE", "A coupon is eligible only at a configured order milestone", {
        successfulOrders: count, milestoneEvery: every
      });
    }
    const previous = await tx.coupon.findUnique({ where: { milestoneOrderCount: count } });
    if (previous) {
      return { code: previous.code, milestoneOrderCount: count, percent: previous.percent, status: previous.status, alreadyGenerated: true };
    }
    const code = `REWARD-${randomBytes(6).toString("hex").toUpperCase()}`;
    const coupon = await tx.coupon.create({
      data: { code, milestoneOrderCount: count, percent, status: "available" }
    });
    return { code: coupon.code, milestoneOrderCount: count, percent: coupon.percent, status: coupon.status, alreadyGenerated: false };
  });
}

export async function getReport(db: PrismaClient) {
  const [orders, items, coupons] = await Promise.all([
    db.order.aggregate({
      _count: { _all: true },
      _sum: { grossCents: true, discountCents: true, netCents: true }
    }),
    db.orderItem.groupBy({
      by: ["productId", "productName"],
      _sum: { quantity: true },
      orderBy: { productId: "asc" }
    }),
    db.coupon.groupBy({ by: ["status"], _count: { _all: true } })
  ]);
  const counts = Object.fromEntries(coupons.map(coupon => [coupon.status, coupon._count._all]));
  const { every, percent } = config();
  return {
    successfullyPlacedOrders: orders._count._all,
    purchasedQuantityByProduct: items.map(item => ({
      productId: item.productId, productName: item.productName, quantity: item._sum.quantity ?? 0
    })),
    grossRevenue: money(orders._sum.grossCents ?? 0),
    discountsGranted: money(orders._sum.discountCents ?? 0),
    netRevenue: money(orders._sum.netCents ?? 0),
    coupons: {
      generated: Object.values(counts).reduce((sum, count) => sum + count, 0),
      available: counts.available ?? 0,
      redeemed: counts.redeemed ?? 0
    },
    rewardEveryNOrders: every,
    couponPercent: percent
  };
}

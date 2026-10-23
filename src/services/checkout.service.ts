import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/api-error";
import { money } from "./cart.service";

export async function getOrder(db: PrismaClient, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { productId: "asc" } } }
  });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order does not exist");
  return {
    id: order.id,
    cartId: order.cartId,
    couponCode: order.couponCode,
    grossTotal: money(order.grossCents),
    discount: money(order.discountCents),
    netTotal: money(order.netCents),
    createdAt: order.createdAt,
    items: order.items.map(item => ({
      productId: item.productId,
      name: item.productName,
      quantity: item.quantity,
      unitPrice: money(item.unitPriceCents),
      lineTotal: money(item.lineTotalCents)
    }))
  };
}

export async function checkout(
  db: PrismaClient,
  cartId: string,
  idempotencyKey: string,
  suppliedCouponCode?: string
) {
  const orderId = await db.$transaction(async tx => {
    const previous = await tx.order.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.cartId !== cartId) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Key was used for another cart");
      }
      return previous.id;
    }

    const cart = await tx.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: true } } }
    });
    if (!cart) throw new ApiError(404, "CART_NOT_FOUND", "Cart does not exist");
    if (cart.status !== "open") throw new ApiError(409, "CART_CLOSED", "Cart has already been checked out");
    if (!cart.items.length) throw new ApiError(422, "EMPTY_CART", "Cannot check out an empty cart");

    for (const item of cart.items) {
      if (item.product.inventory < item.quantity) {
        throw new ApiError(409, "INSUFFICIENT_INVENTORY", "Insufficient inventory", {
          productId: item.productId,
          requested: item.quantity,
          available: item.product.inventory
        });
      }
    }

    const gross = cart.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
    const couponCode = suppliedCouponCode?.toUpperCase() ?? null;
    let discount = 0;
    if (couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: couponCode } });
      if (!coupon) throw new ApiError(422, "INVALID_COUPON", "Coupon does not exist");
      if (coupon.status !== "available") {
        throw new ApiError(409, "COUPON_ALREADY_REDEEMED", "Coupon has already been redeemed");
      }
      // Half-up to the nearest cent, using integer arithmetic.
      discount = Math.min(gross, Math.floor((gross * coupon.percent + 50) / 100));
    }

    const id = randomUUID();
    await tx.order.create({
      data: {
        id, cartId, idempotencyKey, couponCode,
        grossCents: gross, discountCents: discount, netCents: gross - discount,
        items: {
          create: cart.items.map(item => ({
            productId: item.productId,
            productName: item.product.name,
            unitPriceCents: item.product.priceCents,
            quantity: item.quantity,
            lineTotalCents: item.product.priceCents * item.quantity
          }))
        }
      }
    });

    for (const item of cart.items) {
      const changed = await tx.product.updateMany({
        where: { id: item.productId, inventory: { gte: item.quantity } },
        data: { inventory: { decrement: item.quantity } }
      });
      if (!changed.count) {
        throw new ApiError(409, "INSUFFICIENT_INVENTORY", "Inventory changed during checkout", {
          productId: item.productId
        });
      }
    }

    if (couponCode) {
      const claimed = await tx.coupon.updateMany({
        where: { code: couponCode, status: "available" },
        data: { status: "redeemed", orderId: id }
      });
      if (!claimed.count) throw new ApiError(409, "COUPON_ALREADY_REDEEMED", "Coupon has already been redeemed");
    }

    const closed = await tx.cart.updateMany({
      where: { id: cartId, status: "open" },
      data: { status: "checked_out" }
    });
    if (!closed.count) throw new ApiError(409, "CART_CLOSED", "Cart has already been checked out");
    return id;
  }, { timeout: 10000 });

  return getOrder(db, orderId);
}

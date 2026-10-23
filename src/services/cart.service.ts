import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/api-error";

type Db = PrismaClient | Prisma.TransactionClient;
export const money = (value: number) => (value / 100).toFixed(2);

export async function getCart(db: Db, cartId: string) {
  const cart = await db.cart.findUnique({
    where: { id: cartId },
    include: { items: { include: { product: true }, orderBy: { productId: "asc" } } }
  });
  if (!cart) throw new ApiError(404, "CART_NOT_FOUND", "Cart does not exist");
  return {
    id: cart.id,
    status: cart.status,
    items: cart.items.map(item => ({
      productId: item.productId,
      name: item.product.name,
      quantity: item.quantity,
      unitPrice: money(item.product.priceCents),
      lineTotal: money(item.product.priceCents * item.quantity),
      availableInventory: item.product.inventory
    })),
    subtotal: money(cart.items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0))
  };
}

export async function createCart(db: PrismaClient) {
  const cart = await db.cart.create({ data: { id: randomUUID() } });
  return getCart(db, cart.id);
}

export async function addCartItem(db: PrismaClient, cartId: string, productId: string, quantity: number) {
  await db.$transaction(async tx => {
    const cart = await tx.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new ApiError(404, "CART_NOT_FOUND", "Cart does not exist");
    if (cart.status !== "open") throw new ApiError(409, "CART_CLOSED", "Checked-out carts cannot be changed");
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product does not exist");
    const old = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } }
    });
    const nextQuantity = quantity + (old?.quantity ?? 0);
    if (nextQuantity > 100000) throw new ApiError(422, "INVALID_QUANTITY", "Quantity exceeds limit");
    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity: nextQuantity },
      update: { quantity: nextQuantity }
    });
  });
  return getCart(db, cartId);
}

export async function updateCartItem(db: PrismaClient, cartId: string, productId: string, quantity: number) {
  await db.$transaction(async tx => {
    const cart = await tx.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new ApiError(404, "CART_NOT_FOUND", "Cart does not exist");
    if (cart.status !== "open") throw new ApiError(409, "CART_CLOSED", "Checked-out carts cannot be changed");
    const result = await tx.cartItem.updateMany({ where: { cartId, productId }, data: { quantity } });
    if (!result.count) throw new ApiError(404, "CART_ITEM_NOT_FOUND", "Item is not in cart");
  });
  return getCart(db, cartId);
}

export async function removeCartItem(db: PrismaClient, cartId: string, productId: string) {
  await db.$transaction(async tx => {
    const cart = await tx.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new ApiError(404, "CART_NOT_FOUND", "Cart does not exist");
    if (cart.status !== "open") throw new ApiError(409, "CART_CLOSED", "Checked-out carts cannot be changed");
    const result = await tx.cartItem.deleteMany({ where: { cartId, productId } });
    if (!result.count) throw new ApiError(404, "CART_ITEM_NOT_FOUND", "Item is not in cart");
  });
}

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../errors/api-error";
import { addCartItem, createCart, getCart, removeCartItem, updateCartItem } from "../services/cart.service";

const itemSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(100000) });
const quantitySchema = z.object({ quantity: z.number().int().positive().max(100000) });
export const cartsRouter = Router();

cartsRouter.post("/", async (_req, res, next) => {
  try { res.status(201).json(await createCart(prisma)); } catch (error) { next(error); }
});
cartsRouter.get("/:cartId", async (req, res, next) => {
  try { res.json(await getCart(prisma, req.params.cartId)); } catch (error) { next(error); }
});
cartsRouter.post("/:cartId/items", async (req, res, next) => {
  try {
    const body = itemSchema.parse(req.body);
    res.json(await addCartItem(prisma, req.params.cartId, body.productId, body.quantity));
  } catch (error) { next(error); }
});
cartsRouter.put("/:cartId/items/:productId", async (req, res, next) => {
  try {
    const body = quantitySchema.parse(req.body);
    res.json(await updateCartItem(prisma, req.params.cartId, req.params.productId, body.quantity));
  } catch (error) { next(error); }
});
cartsRouter.delete("/:cartId/items/:productId", async (req, res, next) => {
  try {
    await removeCartItem(prisma, req.params.cartId, req.params.productId);
    res.status(204).end();
  } catch (error) { next(error); }
});

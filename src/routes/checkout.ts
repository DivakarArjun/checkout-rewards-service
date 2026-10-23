import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../errors/api-error";
import { checkout } from "../services/checkout.service";

const checkoutSchema = z.object({ couponCode: z.string().min(1).optional() });
export const checkoutRouter = Router();

checkoutRouter.post("/:cartId/checkout", async (req, res, next) => {
  try {
    const body = checkoutSchema.parse(req.body ?? {});
    const key = req.header("Idempotency-Key");
    if (!key?.trim()) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Supply an Idempotency-Key header");
    if (key.length > 200) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is too long");
    res.status(201).json(await checkout(prisma, req.params.cartId, key, body.couponCode));
  } catch (error) { next(error); }
});

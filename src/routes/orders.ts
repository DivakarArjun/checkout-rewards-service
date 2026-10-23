import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getOrder } from "../services/checkout.service";

export const ordersRouter = Router();
ordersRouter.get("/:orderId", async (req, res, next) => {
  try { res.json(await getOrder(prisma, req.params.orderId)); } catch (error) { next(error); }
});

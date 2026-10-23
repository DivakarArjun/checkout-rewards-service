import { Router } from "express";
import { prisma } from "../lib/prisma";
import { generateCoupon, getReport } from "../services/rewards.service";

export const adminRouter = Router();
adminRouter.post("/coupons/generate", async (_req, res, next) => {
  try { res.status(201).json(await generateCoupon(prisma)); } catch (error) { next(error); }
});
adminRouter.get("/report", async (_req, res, next) => {
  try { res.json(await getReport(prisma)); } catch (error) { next(error); }
});

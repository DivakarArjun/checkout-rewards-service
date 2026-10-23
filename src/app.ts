import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma";
import { errorHandler } from "./errors/api-error";
import { cartsRouter } from "./routes/carts";
import { checkoutRouter } from "./routes/checkout";
import { ordersRouter } from "./routes/orders";
import { adminRouter } from "./routes/admin";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/products", async (_req, res, next) => {
    try {
      const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
      res.json(products.map(product => ({
        id: product.id, name: product.name,
        unitPrice: (product.priceCents / 100).toFixed(2), inventory: product.inventory
      })));
    } catch (error) { next(error); }
  });

  app.use("/carts", cartsRouter);
  app.use("/carts", checkoutRouter);
  app.use("/orders", ordersRouter);
  app.use("/admin", adminRouter);
  app.use(errorHandler);
  return app;
}

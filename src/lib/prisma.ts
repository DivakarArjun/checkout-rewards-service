import { PrismaClient } from "@prisma/client";

// One shared Prisma client per application process.
export const prisma = new PrismaClient();

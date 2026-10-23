import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const products = [
  { id: "pasta", name: "Pasta", priceCents: 399, inventory: 100 },
  { id: "coffee", name: "Coffee", priceCents: 299, inventory: 100 },
  { id: "tea", name: "Tea", priceCents: 199, inventory: 100 },
  { id: "olive-oil", name: "Olive Oil", priceCents: 1299, inventory: 20 },
  { id: "limited-mug", name: "Limited Mug", priceCents: 1599, inventory: 3 },
  { id: "chocolate", name: "Chocolate", priceCents: 249, inventory: 50 }
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: product
    });
  }
}

main().finally(async () => prisma.$disconnect());

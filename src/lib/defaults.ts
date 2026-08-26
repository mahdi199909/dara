import { prisma } from "./db";
import { DEFAULT_CATEGORIES } from "./defaultCategories";

export { DEFAULT_CATEGORIES };

export async function seedDefaultCategoriesForUser(userId: string) {
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })),
  });
}

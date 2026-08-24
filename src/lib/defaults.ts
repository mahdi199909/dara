import { prisma } from "./db";

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  icon: string;
  color: string;
  kind: "PRODUCTIVE" | "NEUTRAL" | "WASTE";
  valueType: "EXPENSE" | "ASSET";
}> = [
  { name: "کار", icon: "💼", color: "#2c7166", kind: "PRODUCTIVE", valueType: "EXPENSE" },
  { name: "پروژه", icon: "📁", color: "#3a8d80", kind: "PRODUCTIVE", valueType: "EXPENSE" },
  { name: "دانشگاه", icon: "🎓", color: "#57a89c", kind: "PRODUCTIVE", valueType: "ASSET" },
  { name: "یادگیری", icon: "📚", color: "#4c8577", kind: "PRODUCTIVE", valueType: "ASSET" },
  { name: "سلامت", icon: "❤️", color: "#5c9c7a", kind: "PRODUCTIVE", valueType: "ASSET" },
  { name: "استراحت بدون تکنولوژی", icon: "🧘", color: "#7a9c8a", kind: "PRODUCTIVE", valueType: "ASSET" },
  { name: "خانواده", icon: "👨‍👩‍👧", color: "#8a8a8a", kind: "NEUTRAL", valueType: "EXPENSE" },
  { name: "تفریح", icon: "🎮", color: "#b0a24a", kind: "NEUTRAL", valueType: "EXPENSE" },
  { name: "شبکه‌های اجتماعی", icon: "📱", color: "#c95a4c", kind: "WASTE", valueType: "EXPENSE" },
  { name: "خرید", icon: "🛍️", color: "#8a7ac9", kind: "NEUTRAL", valueType: "EXPENSE" },
  { name: "مالی", icon: "💰", color: "#c9a13a", kind: "NEUTRAL", valueType: "EXPENSE" },
  { name: "شخصی", icon: "🙂", color: "#6b8a9c", kind: "NEUTRAL", valueType: "EXPENSE" },
];

export async function seedDefaultCategoriesForUser(userId: string) {
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })),
  });
}

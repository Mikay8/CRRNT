import palette from "@/constants/colors";

export type Category = "celebrity" | "tech" | "government" | "sports";

export interface CategoryMeta {
  key: Category;
  label: string;
  short: string;
  color: string;
  icon: "mic" | "hardware-chip" | "business" | "trophy";
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "celebrity", label: "Celebrity", short: "Celeb", color: palette.celebrity, icon: "mic" },
  { key: "tech", label: "Tech", short: "Tech", color: palette.tech, icon: "hardware-chip" },
  { key: "government", label: "Government", short: "Gov", color: palette.government, icon: "business" },
  { key: "sports", label: "Sports", short: "Sports", color: palette.sports, icon: "trophy" },
];

export function getCategoryMeta(key: string | null | undefined): CategoryMeta | null {
  if (!key) return null;
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

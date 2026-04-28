import palette from "@/constants/colors";

export type Category = "celebrity" | "tech" | "government" | "sports" | "business" | "science";

export interface CategoryMeta {
  key: Category;
  label: string;
  short: string;
  color: string;
  icon: "mic" | "hardware-chip" | "business" | "trophy" | "briefcase" | "planet";
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "celebrity", label: "Celebrity", short: "Celeb", color: palette.celebrity, icon: "mic" },
  { key: "tech",      label: "Tech",      short: "Tech",  color: palette.tech,      icon: "hardware-chip" },
  { key: "government",label: "Government",short: "Gov",   color: palette.government,icon: "business" },
  { key: "sports",    label: "Sports",    short: "Sports",color: palette.sports,    icon: "trophy" },
  { key: "business",  label: "Business",  short: "Biz",   color: palette.business,  icon: "briefcase" },
  { key: "science",   label: "Science",   short: "Sci",   color: palette.science,   icon: "planet" },
];

export function getCategoryMeta(key: string | null | undefined): CategoryMeta | null {
  if (!key) return null;
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

import type { Ionicons } from "@expo/vector-icons";
import palette from "@/constants/colors";

export type Category =
  | "celebrity"
  | "tech"
  | "government"
  | "sports"
  | "business"
  | "science"
  | "entertainment"
  | "world"
  | "health";

export interface CategoryMeta {
  key: Category;
  label: string;
  short: string;
  color: string;
  icon:
    | "mic"
    | "hardware-chip"
    | "business"
    | "trophy"
    | "briefcase"
    | "planet"
    | "film"
    | "globe"
    | "heart";
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "celebrity",     label: "Celebrity",     short: "Celeb",  color: palette.celebrity,     icon: "mic"           },
  { key: "entertainment", label: "Entertainment", short: "Ent",    color: palette.entertainment, icon: "film"          },
  { key: "tech",          label: "Tech",          short: "Tech",   color: palette.tech,          icon: "hardware-chip" },
  { key: "government",    label: "Government",    short: "Gov",    color: palette.government,    icon: "business"      },
  { key: "sports",        label: "Sports",        short: "Sports", color: palette.sports,        icon: "trophy"        },
  { key: "business",      label: "Business",      short: "Biz",    color: palette.business,      icon: "briefcase"     },
  { key: "science",       label: "Science",       short: "Sci",    color: palette.science,       icon: "planet"        },
  { key: "world",         label: "World",         short: "World",  color: palette.world,         icon: "globe"         },
  { key: "health",        label: "Health",        short: "Health", color: palette.health,        icon: "heart"         },
];

// Keyed by every CategoryMeta icon, so adding a category without an icon is a type error.
export const CATEGORY_ICONS: Record<CategoryMeta["icon"], keyof typeof Ionicons.glyphMap> = {
  mic: "mic",
  "hardware-chip": "hardware-chip",
  business: "business",
  trophy: "trophy",
  briefcase: "briefcase-outline",
  planet: "planet-outline",
  film: "film-outline",
  globe: "globe-outline",
  heart: "heart-outline",
};

export function getCategoryMeta(key: string | null | undefined): CategoryMeta | null {
  if (!key) return null;
  return CATEGORIES.find((c) => c.key === key) ?? null;
}

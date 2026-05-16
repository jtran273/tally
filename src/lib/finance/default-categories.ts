export interface DefaultSystemCategory {
  color: string;
  icon: string;
  name: string;
}

export const DEFAULT_SYSTEM_CATEGORIES = [
  { color: "#6b7280", icon: "circle-help", name: "Uncategorized" },
  { color: "#dc6b3d", icon: "utensils", name: "Food" },
  { color: "#3b82f6", icon: "sparkles", name: "Software" },
  { color: "#16a34a", icon: "activity", name: "Health & Fitness" },
  { color: "#0284c7", icon: "car", name: "Transportation" },
  { color: "#2563eb", icon: "car-front", name: "Auto" },
  { color: "#7c3aed", icon: "plane", name: "Travel" },
  { color: "#65a30d", icon: "shopping-basket", name: "Groceries" },
  { color: "#059669", icon: "arrow-down", name: "Income" },
  { color: "#ea580c", icon: "shopping-bag", name: "Shopping" },
  { color: "#92400e", icon: "home", name: "Housing" },
  { color: "#435fb6", icon: "graduation-cap", name: "Education" },
  { color: "#be185d", icon: "ticket", name: "Entertainment" }
] as const satisfies readonly DefaultSystemCategory[];

export function missingDefaultSystemCategories(existingNames: Iterable<string>) {
  const existing = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  return DEFAULT_SYSTEM_CATEGORIES.filter((category) => !existing.has(category.name.toLowerCase()));
}

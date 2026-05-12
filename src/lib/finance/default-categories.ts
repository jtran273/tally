export interface DefaultSystemCategory {
  color: string;
  icon: string;
  name: string;
}

export const DEFAULT_SYSTEM_CATEGORIES = [
  { color: "#6b7280", icon: "circle-help", name: "Uncategorized" },
  { color: "#dc6b3d", icon: "utensils", name: "Food / Restaurants" },
  { color: "#3b82f6", icon: "sparkles", name: "Software / AI Tools" },
  { color: "#6366f1", icon: "cloud", name: "Software / SaaS" },
  { color: "#0f766e", icon: "server", name: "Software / Hosting" },
  { color: "#16a34a", icon: "activity", name: "Health / Fitness" },
  { color: "#0284c7", icon: "car", name: "Transport / Rideshare" },
  { color: "#2563eb", icon: "car-front", name: "Auto / Car Maintenance" },
  { color: "#7c3aed", icon: "plane", name: "Travel / Flights" },
  { color: "#65a30d", icon: "shopping-basket", name: "Groceries" },
  { color: "#71717a", icon: "repeat", name: "Transfer" },
  { color: "#059669", icon: "arrow-down", name: "Income" },
  { color: "#ea580c", icon: "shopping-bag", name: "Shopping" },
  { color: "#92400e", icon: "home", name: "Housing" },
  { color: "#0891b2", icon: "pill", name: "Health / Pharmacy" },
  { color: "#435fb6", icon: "graduation-cap", name: "Education" },
  { color: "#be185d", icon: "ticket", name: "Entertainment" }
] as const satisfies readonly DefaultSystemCategory[];

export function missingDefaultSystemCategories(existingNames: Iterable<string>) {
  const existing = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
  return DEFAULT_SYSTEM_CATEGORIES.filter((category) => !existing.has(category.name.toLowerCase()));
}

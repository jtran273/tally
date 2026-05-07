"use server";

import { revalidatePath } from "next/cache";
import { listCategories, recordAuditEvent, upsertCategory, type Json } from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";

export interface CategoryActionState {
  error?: string;
  message?: string;
}

const colorPattern = /^#[0-9a-f]{6}$/i;
const iconPattern = /^[a-z0-9-]{1,48}$/i;

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanCategoryName(value: FormDataEntryValue | null) {
  return cleanString(value, 80).replace(/\s+/g, " ");
}

function errorState(error: unknown): CategoryActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to save category."
  };
}

function revalidateCategoryPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/recurring");
  revalidatePath("/review");
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

export async function createCategoryAction(
  _state: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  try {
    const name = cleanCategoryName(formData.get("categoryName"));
    if (!name) return { error: "Category name is required." };
    if (name.length < 2) return { error: "Use at least 2 characters for the category name." };

    const rawColor = cleanString(formData.get("color"), 16);
    const color = rawColor ? rawColor.toLowerCase() : null;
    if (color && !colorPattern.test(color)) return { error: "Choose a valid category color." };

    const rawIcon = cleanString(formData.get("icon"), 48);
    const icon = rawIcon && iconPattern.test(rawIcon) ? rawIcon : null;

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to save categories." };
    if (context.isDemo) {
      return { message: "Demo mode is read-only. Sign in to save custom categories." };
    }

    const categories = await listCategories(context.client, context.userId);
    const existing = categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (existing) return { message: `${existing.name} already exists.` };

    const category = await upsertCategory(context.client, context.userId, {
      color,
      icon,
      name
    });

    await recordAuditEvent(context.client, context.userId, {
      action: "category.upserted",
      actorId: context.userId,
      afterData: {
        color: category.color,
        icon: category.icon,
        id: category.id,
        name: category.name
      } satisfies Json,
      beforeData: null,
      entityId: category.id,
      entityTable: "categories",
      metadata: {
        source: "settings_category_manager"
      }
    });

    revalidateCategoryPaths();

    return { message: `Saved ${category.name}.` };
  } catch (error) {
    return errorState(error);
  }
}

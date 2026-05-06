import type { SupabaseClient } from "@supabase/supabase-js";
import { CountryCode, Products, type Institution } from "plaid";
import type { Database, InstitutionRow, PlaidItemRow } from "../db/types";
import { getPlaidClient } from "./client";
import { getSafePlaidError } from "./errors";
import { encryptPlaidAccessToken } from "./token-vault";

type InstitutionInsert = Database["public"]["Tables"]["institutions"]["Insert"];
type InstitutionUpdate = Database["public"]["Tables"]["institutions"]["Update"];
type PlaidItemInsert = Database["public"]["Tables"]["plaid_items"]["Insert"];

const INSTITUTION_COLUMNS = "id,user_id,name,plaid_institution_id,logo_url,primary_color,website_url,created_at,updated_at";
const PLAID_ITEM_COLUMNS = [
  "id",
  "user_id",
  "institution_id",
  "plaid_item_id",
  "status",
  "available_products",
  "billed_products",
  "error_code",
  "error_message",
  "consent_expires_at",
  "created_at",
  "updated_at"
].join(",");

export interface PlaidInstitutionInput {
  institutionId?: string | null;
  name?: string | null;
}

type FinanceSupabaseClient = SupabaseClient;
type PlaidItemPublicRow = Omit<PlaidItemRow, "access_token_ciphertext" | "last_successful_sync_at" | "transaction_cursor">;

export interface PlaidConnectionSummary {
  availableProducts: string[];
  billedProducts: string[];
  consentExpiresAt: string | null;
  createdAt: string;
  errorCode: string | null;
  id: string;
  institutionId: string;
  institutionName: string;
  plaidInstitutionId: string | null;
  plaidItemId: string;
  status: PlaidItemRow["status"];
  updatedAt: string;
}

export interface PlaidLinkTokenResult {
  expiration: string;
  linkToken: string;
  requestId: string;
}

function toConnectionSummary(item: PlaidItemPublicRow, institution?: InstitutionRow): PlaidConnectionSummary {
  return {
    availableProducts: item.available_products,
    billedProducts: item.billed_products,
    consentExpiresAt: item.consent_expires_at,
    createdAt: item.created_at,
    errorCode: item.error_code,
    id: item.id,
    institutionId: item.institution_id,
    institutionName: institution?.name ?? "Unknown institution",
    plaidInstitutionId: institution?.plaid_institution_id ?? null,
    plaidItemId: item.plaid_item_id,
    status: item.status,
    updatedAt: item.updated_at
  };
}

function byId(rows: InstitutionRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function coalesceInstitutionName(...names: Array<string | null | undefined>) {
  return names.find((name) => typeof name === "string" && name.trim())?.trim() ?? "Plaid institution";
}

async function findExistingInstitution(
  client: FinanceSupabaseClient,
  userId: string,
  plaidInstitutionId: string | null,
  name: string
) {
  if (plaidInstitutionId) {
    const result = await client
      .from("institutions")
      .select(INSTITUTION_COLUMNS)
      .eq("user_id", userId)
      .eq("plaid_institution_id", plaidInstitutionId)
      .maybeSingle();

    if (result.error) throw new Error(`Find Plaid institution: ${result.error.message}`);
    if (result.data) return result.data;
  }

  const result = await client
    .from("institutions")
    .select(INSTITUTION_COLUMNS)
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();

  if (result.error) throw new Error(`Find Plaid institution by name: ${result.error.message}`);
  return result.data;
}

async function fetchInstitutionDetails(plaidInstitutionId: string | null) {
  if (!plaidInstitutionId) return null;

  try {
    const plaid = getPlaidClient();
    const response = await plaid.institutionsGetById({
      country_codes: [CountryCode.Us],
      institution_id: plaidInstitutionId,
      options: {
        include_optional_metadata: true
      }
    });

    return response.data.institution;
  } catch (error) {
    console.warn("plaid_institution_metadata_fetch_failed", getSafePlaidError(error));
    return null;
  }
}

async function upsertInstitution({
  client,
  details,
  fallback,
  itemInstitutionId,
  itemInstitutionName,
  userId
}: {
  client: FinanceSupabaseClient;
  details: Institution | null;
  fallback?: PlaidInstitutionInput;
  itemInstitutionId: string | null;
  itemInstitutionName: string | null;
  userId: string;
}) {
  const plaidInstitutionId = details?.institution_id ?? itemInstitutionId ?? fallback?.institutionId ?? null;
  const name = coalesceInstitutionName(details?.name, itemInstitutionName, fallback?.name);
  const existing = await findExistingInstitution(client, userId, plaidInstitutionId, name);
  const update: InstitutionUpdate = {
    name,
    plaid_institution_id: plaidInstitutionId,
    primary_color: details?.primary_color ?? undefined,
    website_url: details?.url ?? undefined
  };

  if (existing) {
    const result = await client
      .from("institutions")
      .update(update)
      .eq("user_id", userId)
      .eq("id", existing.id)
      .select(INSTITUTION_COLUMNS)
      .single();

    if (result.error || !result.data) {
      throw new Error(`Update Plaid institution: ${result.error?.message ?? "No data returned."}`);
    }

    return result.data as InstitutionRow;
  }

  const insert: InstitutionInsert = {
    ...update,
    user_id: userId
  };
  const result = await client
    .from("institutions")
    .insert(insert)
    .select(INSTITUTION_COLUMNS)
    .single();

  if (result.error || !result.data) {
    throw new Error(`Insert Plaid institution: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data as InstitutionRow;
}

async function upsertPlaidItem({
  accessToken,
  client,
  institutionId,
  item,
  userId
}: {
  accessToken: string;
  client: FinanceSupabaseClient;
  institutionId: string;
  item: {
    available_products: Products[];
    billed_products: Products[];
    consent_expiration_time: string | null;
    error: { error_code: string; error_message: string } | null;
    item_id: string;
  };
  userId: string;
}) {
  const insert: PlaidItemInsert = {
    access_token_ciphertext: encryptPlaidAccessToken(accessToken),
    available_products: item.available_products,
    billed_products: item.billed_products,
    consent_expires_at: item.consent_expiration_time,
    error_code: item.error?.error_code ?? null,
    error_message: item.error?.error_message ?? null,
    institution_id: institutionId,
    plaid_item_id: item.item_id,
    status: item.error ? "error" : "active",
    user_id: userId
  };
  const result = await client
    .from("plaid_items")
    .upsert(insert, { onConflict: "user_id,plaid_item_id" })
    .select(PLAID_ITEM_COLUMNS)
    .single();

  if (result.error || !result.data) {
    throw new Error(`Persist Plaid item: ${result.error?.message ?? "No data returned."}`);
  }

  return result.data as unknown as PlaidItemPublicRow;
}

export async function createPlaidLinkToken({
  userEmail,
  userId
}: {
  userEmail: string | null;
  userId: string;
}): Promise<PlaidLinkTokenResult> {
  const plaid = getPlaidClient();
  const response = await plaid.linkTokenCreate({
    client_name: "Ledger",
    country_codes: [CountryCode.Us],
    language: "en",
    products: [Products.Transactions],
    user: {
      client_user_id: userId,
      email_address: userEmail ?? undefined
    }
  });

  return {
    expiration: response.data.expiration,
    linkToken: response.data.link_token,
    requestId: response.data.request_id
  };
}

export async function exchangePlaidPublicToken({
  client,
  institution,
  publicToken,
  userId
}: {
  client: FinanceSupabaseClient;
  institution?: PlaidInstitutionInput;
  publicToken: string;
  userId: string;
}) {
  const plaid = getPlaidClient();
  const exchangeResponse = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchangeResponse.data.access_token;
  const itemResponse = await plaid.itemGet({ access_token: accessToken });
  const item = itemResponse.data.item;
  const institutionDetails = await fetchInstitutionDetails(item.institution_id ?? institution?.institutionId ?? null);
  const institutionRow = await upsertInstitution({
    client,
    details: institutionDetails,
    fallback: institution,
    itemInstitutionId: item.institution_id ?? null,
    itemInstitutionName: item.institution_name ?? null,
    userId
  });
  const plaidItem = await upsertPlaidItem({
    accessToken,
    client,
    institutionId: institutionRow.id,
    item: {
      available_products: item.available_products,
      billed_products: item.billed_products,
      consent_expiration_time: item.consent_expiration_time,
      error: item.error
        ? {
          error_code: item.error.error_code,
          error_message: item.error.error_message
        }
        : null,
      item_id: item.item_id
    },
    userId
  });

  return toConnectionSummary(plaidItem, institutionRow);
}

export async function listPlaidConnections(client: FinanceSupabaseClient, userId: string) {
  const itemResult = await client
    .from("plaid_items")
    .select(PLAID_ITEM_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (itemResult.error || !itemResult.data) {
    throw new Error(`List Plaid items: ${itemResult.error?.message ?? "No data returned."}`);
  }

  const itemRows = itemResult.data as unknown as PlaidItemPublicRow[];

  if (itemRows.length === 0) return [];

  const institutionIds = [...new Set(itemRows.map((item) => item.institution_id))];
  const institutionResult = await client
    .from("institutions")
    .select(INSTITUTION_COLUMNS)
    .eq("user_id", userId)
    .in("id", institutionIds);

  if (institutionResult.error || !institutionResult.data) {
    throw new Error(`List Plaid institutions: ${institutionResult.error?.message ?? "No data returned."}`);
  }

  const institutionRows = institutionResult.data as InstitutionRow[];
  const institutionById = byId(institutionRows);
  return itemRows.map((item) => toConnectionSummary(item, institutionById.get(item.institution_id)));
}

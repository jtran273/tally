import type { AccountRecord } from "@/lib/db";

export function cleanInstitutionName(name: string) {
  return name.replace(/\s*\(manual\)\s*$/i, "").trim();
}

export function friendlyAccountLabel(account: AccountRecord) {
  const institution = cleanInstitutionName(account.institutionName) || account.name.trim();
  const subtype = account.subtype?.toLowerCase() ?? "";

  if (account.type === "depository") {
    if (subtype.includes("saving")) return `${institution} savings`;
    if (subtype.includes("money")) return `${institution} money market`;
    return `${institution} checking`;
  }
  if (account.type === "credit") return `${institution} card`;
  if (account.type === "investment") return `${institution} investments`;
  return `${institution} retirement`;
}

export function accountGroupLabel(account: AccountRecord) {
  if (account.type === "depository") return "Checking & savings";
  if (account.type === "credit") return "Credit card";
  if (account.type === "investment") return "Investments";
  return "Retirement";
}

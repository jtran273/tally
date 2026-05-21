import { AppShell } from "@/components/shell/app-shell";
import { isDemoMode } from "@/lib/demo/auth";
import { type ReactNode } from "react";

export default async function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  const isDemo = await isDemoMode();

  return <AppShell isDemo={isDemo}>{children}</AppShell>;
}

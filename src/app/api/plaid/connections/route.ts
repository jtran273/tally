import { isDemoMode } from "@/lib/demo/auth";
import { listDemoPlaidConnections } from "@/lib/demo/finance-client";
import { plaidRouteError, requirePlaidRouteUser } from "@/lib/plaid/route-helpers";
import { getPlaidRuntimeEnvironment } from "@/lib/plaid/config";
import { listPlaidConnections } from "@/lib/plaid/service";
import { jsonNoStore } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  if (await isDemoMode()) {
    return jsonNoStore({
      connections: listDemoPlaidConnections(),
      environment: getPlaidRuntimeEnvironment()
    });
  }

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const connections = await listPlaidConnections(context.supabase, context.user.id);
    const environment = getPlaidRuntimeEnvironment();

    return jsonNoStore({ connections, environment });
  } catch (error) {
    return plaidRouteError(
      "plaid_connections_list_failed",
      error,
      "Unable to load Plaid connections."
    );
  }
}

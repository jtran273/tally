import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The Agent inbox has been merged into the unified Review tab as the "Proposals"
// section. Keep this route so existing links, bookmarks, and revalidatePath("/agent-inbox")
// calls resolve instead of 404ing.
export default function AgentInboxPage() {
  redirect("/review");
}

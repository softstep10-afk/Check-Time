"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setUserCapability, type CapabilityKey, CAPABILITIES } from "@/lib/capabilities";
import { isManagerRole } from "@/lib/manager-utils";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";

const KNOWN_KEYS = new Set<string>(CAPABILITIES.map((capability) => capability.key));

export type ToggleResult =
  | { ok: true }
  | { ok: false; missingTable?: boolean; message?: string };

export async function toggleUserCapability(args: {
  userId: string;
  capability: CapabilityKey;
  granted: boolean;
}): Promise<ToggleResult> {
  if (!KNOWN_KEYS.has(args.capability)) {
    return { ok: false, message: "Unknown capability" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // In AUTH_BYPASS demo mode there's no logged-in user — accept the write
  // anyway so the toggle is visible, with a null granted_by.
  let actorId: string | null = user?.id ?? null;
  if (!AUTH_BYPASS_ENABLED) {
    if (!user) return { ok: false, message: "Not signed in" };

    // Confirm the actor is a manager / admin / owner in the same org as
    // the target user. RLS will enforce this too once 00010 is applied,
    // but we double-check here for a clean error before the write.
    const { data: actor } = await supabase
      .from("profiles")
      .select("role, org_id")
      .eq("id", user.id)
      .single<{ role: string; org_id: string }>();
    const { data: target } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", args.userId)
      .single<{ org_id: string }>();
    if (
      !actor ||
      !target ||
      !isManagerRole(actor.role as Parameters<typeof isManagerRole>[0]) ||
      actor.org_id !== target.org_id
    ) {
      return { ok: false, message: "Forbidden" };
    }
    if (
      args.capability === "finance_access" &&
      actor.role !== "owner" &&
      actor.role !== "admin"
    ) {
      return { ok: false, message: "Only owners/admins can change finance access." };
    }
    actorId = user.id;
  }

  const result = await setUserCapability(supabase, {
    userId: args.userId,
    capability: args.capability,
    granted: args.granted,
    grantedBy: actorId,
  });

  if (result.ok) {
    revalidatePath(`/admin/users/${args.userId}/permissions`);
  }

  return result;
}

import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import {
  buildClientListItems,
  type ClientActivity,
  type ClientDetail,
  type ClientListItem,
} from "@/lib/client-directory";
import { requireManagerContext } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import type { BusinessClient, ClientContact } from "@/types/database";

type AuditRow = {
  id: string;
  action: string;
  actor_name: string | null;
  created_at: string;
};

function assertNoError(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export const getClientsDirectoryData = cache(async (): Promise<{
  clients: ClientListItem[];
}> => {
  const supabase = await createClient();
  const { profile } = await requireManagerContext(supabase);

  const [clientsResult, contactsResult] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("name", { ascending: true })
      .returns<BusinessClient[]>(),
    supabase
      .from("client_contacts")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true })
      .returns<ClientContact[]>(),
  ]);

  assertNoError(clientsResult.error, "Clients query failed");
  assertNoError(contactsResult.error, "Client contacts query failed");

  return {
    clients: buildClientListItems(clientsResult.data ?? [], contactsResult.data ?? []),
  };
});

export const getClientDetailData = cache(async (clientId: string): Promise<ClientDetail> => {
  const supabase = await createClient();
  const { profile } = await requireManagerContext(supabase);

  const [clientResult, contactsResult, activityResult] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .eq("org_id", profile.org_id)
      .maybeSingle<BusinessClient>(),
    supabase
      .from("client_contacts")
      .select("*")
      .eq("client_id", clientId)
      .eq("org_id", profile.org_id)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true })
      .returns<ClientContact[]>(),
    supabase
      .from("audit_log")
      .select("id, action, actor_name, created_at")
      .eq("org_id", profile.org_id)
      .eq("target_type", "client")
      .eq("target_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<AuditRow[]>(),
  ]);

  assertNoError(clientResult.error, "Client query failed");
  assertNoError(contactsResult.error, "Client contacts query failed");

  if (!clientResult.data) notFound();

  const activity: ClientActivity[] = activityResult.error
    ? []
    : (activityResult.data ?? []).map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actor_name,
        createdAt: row.created_at,
      }));

  return {
    ...clientResult.data,
    contacts: contactsResult.data ?? [],
    activity,
  };
});

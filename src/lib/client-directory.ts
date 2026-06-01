import type { BusinessClient, ClientContact, ClientStatus } from "@/types/database";

export type ClientSavePayload = Pick<
  BusinessClient,
  | "name"
  | "status"
  | "primary_contact_name"
  | "primary_contact_phone"
  | "primary_contact_email"
  | "address"
  | "internal_note"
>;

export type ClientContactSavePayload = Pick<
  ClientContact,
  "name" | "title" | "phone" | "email" | "is_primary" | "status"
>;

export type ClientValidationResult<T> =
  | { ok: true; payload: T }
  | { ok: false; status: number; error: string };

export interface ClientActivity {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
}

export interface ClientListItem extends BusinessClient {
  contactCount: number;
  primaryContact: ClientContact | null;
}

export interface ClientDetail extends BusinessClient {
  contacts: ClientContact[];
  activity: ClientActivity[];
}

const CLIENT_STATUSES: ClientStatus[] = ["active", "inactive"];

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStatus(value: unknown, fallback: ClientStatus = "active"): ClientStatus {
  return CLIENT_STATUSES.includes(value as ClientStatus) ? (value as ClientStatus) : fallback;
}

export function validateClientSaveBody(
  body: Record<string, unknown>,
  options: { fallbackStatus?: ClientStatus } = {},
): ClientValidationResult<ClientSavePayload> {
  const name = readText(body.name);
  if (!name) {
    return { ok: false, status: 400, error: "Client name is required." };
  }

  return {
    ok: true,
    payload: {
      name,
      status: readStatus(body.status, options.fallbackStatus ?? "active"),
      primary_contact_name: readText(body.primaryContactName ?? body.primary_contact_name),
      primary_contact_phone: readText(body.primaryContactPhone ?? body.primary_contact_phone),
      primary_contact_email: readText(body.primaryContactEmail ?? body.primary_contact_email),
      address: readText(body.address),
      internal_note: readText(body.internalNote ?? body.internal_note),
    },
  };
}

export function validateClientContactSaveBody(
  body: Record<string, unknown>,
): ClientValidationResult<ClientContactSavePayload> {
  const name = readText(body.name);
  if (!name) {
    return { ok: false, status: 400, error: "Contact name is required." };
  }

  return {
    ok: true,
    payload: {
      name,
      title: readText(body.title),
      phone: readText(body.phone),
      email: readText(body.email),
      is_primary: body.isPrimary === true || body.is_primary === true,
      status: readStatus(body.status),
    },
  };
}

export function buildClientListItems(
  clients: BusinessClient[],
  contacts: ClientContact[],
): ClientListItem[] {
  const contactsByClient = new Map<string, ClientContact[]>();
  for (const contact of contacts) {
    const list = contactsByClient.get(contact.client_id) ?? [];
    list.push(contact);
    contactsByClient.set(contact.client_id, list);
  }

  return clients.map((client) => {
    const clientContacts = contactsByClient.get(client.id) ?? [];
    return {
      ...client,
      contactCount: clientContacts.length,
      primaryContact:
        clientContacts.find((contact) => contact.is_primary && contact.status === "active") ??
        clientContacts.find((contact) => contact.status === "active") ??
        null,
    };
  });
}

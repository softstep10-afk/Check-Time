import type {
  BusinessClient,
  ClientContact,
  Project,
  ProjectClient,
} from "@/types/database";

export interface ProjectClientSummary {
  linkId: string;
  id: string;
  name: string;
  status: BusinessClient["status"];
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  address: string | null;
  linkedAt: string;
}

export interface ProjectClientOption {
  id: string;
  name: string;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  address: string | null;
  searchText: string;
}

export interface ClientProjectListItem {
  linkId: string;
  id: string;
  name: string;
  address: string | null;
  status: Project["status"];
  linkedAt: string;
}

export interface ClientProjectOption {
  id: string;
  name: string;
  address: string | null;
  status: Project["status"];
  activeClientId: string | null;
  activeClientName: string | null;
  searchText: string;
}

function normalizeSearchPart(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function findPrimaryContact(clientId: string, contacts: ClientContact[]): ClientContact | null {
  return (
    contacts.find(
      (contact) =>
        contact.client_id === clientId &&
        contact.is_primary &&
        contact.status === "active",
    ) ??
    contacts.find((contact) => contact.client_id === clientId && contact.status === "active") ??
    null
  );
}

export function buildProjectClientSummary({
  link,
  clients,
  contacts,
}: {
  link: ProjectClient | null;
  clients: BusinessClient[];
  contacts: ClientContact[];
}): ProjectClientSummary | null {
  if (!link || link.status !== "active") return null;
  const client = clients.find((item) => item.id === link.client_id);
  if (!client) return null;
  const contact = findPrimaryContact(client.id, contacts);

  return {
    linkId: link.id,
    id: client.id,
    name: client.name,
    status: client.status,
    primaryContactName: contact?.name ?? client.primary_contact_name,
    primaryContactPhone: contact?.phone ?? client.primary_contact_phone,
    primaryContactEmail: contact?.email ?? client.primary_contact_email,
    address: client.address,
    linkedAt: link.linked_at,
  };
}

export function buildProjectClientOptions(
  clients: BusinessClient[],
  contacts: ClientContact[],
): ProjectClientOption[] {
  return clients
    .filter((client) => client.status === "active")
    .map((client) => {
      const contact = findPrimaryContact(client.id, contacts);
      const primaryContactName = contact?.name ?? client.primary_contact_name;
      const primaryContactPhone = contact?.phone ?? client.primary_contact_phone;
      const primaryContactEmail = contact?.email ?? client.primary_contact_email;
      return {
        id: client.id,
        name: client.name,
        primaryContactName,
        primaryContactPhone,
        primaryContactEmail,
        address: client.address,
        searchText: [
          client.name,
          primaryContactName,
          primaryContactPhone,
          primaryContactEmail,
          client.address,
        ]
          .map(normalizeSearchPart)
          .filter(Boolean)
          .join(" "),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildClientLinkedProjects({
  clientId,
  links,
  projects,
}: {
  clientId: string;
  links: ProjectClient[];
  projects: Project[];
}): ClientProjectListItem[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  return links
    .filter((link) => link.client_id === clientId && link.status === "active")
    .map((link) => {
      const project = projectsById.get(link.project_id);
      if (!project) return null;
      return {
        linkId: link.id,
        id: project.id,
        name: project.name,
        address: project.address,
        status: project.status,
        linkedAt: link.linked_at,
      };
    })
    .filter((item): item is ClientProjectListItem => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildClientProjectOptions({
  currentClientId,
  projects,
  activeLinks,
  clients,
}: {
  currentClientId: string;
  projects: Project[];
  activeLinks: ProjectClient[];
  clients: BusinessClient[];
}): ClientProjectOption[] {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const activeLinkByProjectId = new Map(
    activeLinks
      .filter((link) => link.status === "active")
      .map((link) => [link.project_id, link]),
  );

  return projects
    .filter((project) => !project.deleted_at && project.status !== "archived")
    .map((project) => {
      const activeLink = activeLinkByProjectId.get(project.id) ?? null;
      if (activeLink?.client_id === currentClientId) return null;
      const activeClient = activeLink ? clientsById.get(activeLink.client_id) ?? null : null;
      return {
        id: project.id,
        name: project.name,
        address: project.address,
        status: project.status,
        activeClientId: activeClient?.id ?? null,
        activeClientName: activeClient?.name ?? null,
        searchText: [
          project.name,
          project.address,
          project.status,
          activeClient?.name,
        ]
          .map(normalizeSearchPart)
          .filter(Boolean)
          .join(" "),
      };
    })
    .filter((item): item is ClientProjectOption => item !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

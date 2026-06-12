import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const teamMemberSource = readSource("src/components/manager/TeamMemberPage.tsx");
const teamSource = readSource("src/components/manager/TeamPage.tsx");
const projectsSource = readSource("src/components/manager/ProjectsPage.tsx");
const mediaGalleryDrawerSource = readSource("src/components/shared/MediaGalleryDrawer.tsx");
const translationsSource = readSource("src/lib/i18n/translations.ts");

describe("worker media folders and manager search source guards", () => {
  it("keeps worker media grouped into review folders by upload type", () => {
    expect(teamMemberSource).toContain("WORKER_MEDIA_FOLDER_ORDER");
    expect(teamMemberSource).toContain("getWorkerMediaFolderKey");
    expect(teamMemberSource).toContain('entry.media_type === "video" && entry.is_checkout');
    expect(teamMemberSource).toContain('kind === "before_work"');
    expect(teamMemberSource).toContain('entry.media_type === "photo"');
    expect(teamMemberSource).toContain('entry.media_type === "pdf" || entry.media_type === "document"');
    expect(teamMemberSource).toContain("<details");
    expect(teamMemberSource).toContain("section.items.length");
  });

  it("preserves worker media open, download, and flag actions inside folders", () => {
    expect(teamMemberSource).toContain("openMediaItem(entry)");
    expect(teamMemberSource).toContain("downloadMediaItem(entry)");
    expect(teamMemberSource).toContain("<MediaFlagButton");
    expect(teamMemberSource).toContain("setFlagModalMediaId(entry.id)");
  });

  it("keeps the full media gallery drawer grouped into folders too", () => {
    expect(mediaGalleryDrawerSource).toContain("GALLERY_MEDIA_FOLDER_ORDER");
    expect(mediaGalleryDrawerSource).toContain("galleryMediaFolderKey");
    expect(mediaGalleryDrawerSource).toContain("media-gallery-folder-list");
    expect(mediaGalleryDrawerSource).toContain("data-gallery-folder={group.key}");
    expect(mediaGalleryDrawerSource).toContain("group.items.map");
    expect(mediaGalleryDrawerSource).toContain("<GalleryTile");
  });

  it("keeps explicit project and worker search controls visible", () => {
    expect(projectsSource).toContain('data-testid="manager-project-search-panel"');
    expect(projectsSource).toContain('t("projects.searchLabel")');
    expect(projectsSource).toContain("setSearchInput(\"\")");
    expect(projectsSource).toContain("p.name.toLowerCase().includes(searchQuery)");
    expect(projectsSource).toContain("(p.address ?? \"\").toLowerCase().includes(searchQuery)");

    expect(teamSource).toContain('id="team-roster-search"');
    expect(teamSource).toContain('t("team.searchTeamHelp")');
    expect(teamSource).toContain("setQuery(\"\")");
    expect(teamSource).toContain("profile.name.toLowerCase().includes(needle)");
    expect(teamSource).toContain("profile.assignedProjectNames.some");
  });

  it("has labels for the new worker media folders", () => {
    expect(translationsSource).toContain('"teamMember.checkinVideos"');
    expect(translationsSource).toContain('"teamMember.journalVideos"');
    expect(translationsSource).toContain('"teamMember.journalPhotos"');
    expect(translationsSource).toContain('"teamMember.journalDocuments"');
    expect(translationsSource).toContain('"teamMember.journalReceipts"');
    expect(translationsSource).toContain('"teamMember.journalOther"');
    expect(translationsSource).toContain('"gallery.folder.checkoutVideos"');
    expect(translationsSource).toContain('"gallery.folder.documents"');
  });
});

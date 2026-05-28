import { describe, expect, it } from "vitest";
import {
  appendProjectPublicNote,
  readProjectPublicNotes,
  type ProjectPublicNote,
} from "@/lib/project-public-notes";

const firstNote: ProjectPublicNote = {
  id: "note-1",
  text: "Check north entrance",
  authorId: "worker-1",
  authorName: "Worker One",
  createdAt: "2026-05-28T10:00:00.000Z",
};

const secondNote: ProjectPublicNote = {
  id: "note-2",
  text: "Paint delivery arrived",
  authorId: "worker-2",
  authorName: "Worker Two",
  createdAt: "2026-05-28T11:00:00.000Z",
};

describe("project public notes settings helper", () => {
  it("stores public worker notes in project settings without touching manager notes", () => {
    const settings = appendProjectPublicNote({ client_tone: "green" }, firstNote);

    expect(settings.client_tone).toBe("green");
    expect(readProjectPublicNotes(settings)).toEqual([firstNote]);
  });

  it("returns newest notes first", () => {
    const settings = appendProjectPublicNote(
      appendProjectPublicNote({}, firstNote),
      secondNote,
    );

    expect(readProjectPublicNotes(settings).map((note) => note.id)).toEqual([
      "note-2",
      "note-1",
    ]);
  });

  it("ignores malformed note rows safely", () => {
    const notes = readProjectPublicNotes({
      public_project_notes: [
        firstNote,
        { id: "broken", text: "", authorId: "worker-3" },
        null,
        "not a note",
      ],
    });

    expect(notes).toEqual([firstNote]);
  });
});

import { describe, expect, it } from "vitest";
import { parsePastedCoordinatePair } from "@/lib/coordinate-paste";

describe("parsePastedCoordinatePair", () => {
  it("parses comma-separated map coordinates", () => {
    expect(parsePastedCoordinatePair("47.307322, -122.228453")).toEqual({
      lat: "47.307322",
      lng: "-122.228453",
    });
  });

  it("parses coordinate values separated by whitespace or newlines", () => {
    expect(parsePastedCoordinatePair("47.307322\n-122.228453")).toEqual({
      lat: "47.307322",
      lng: "-122.228453",
    });
  });

  it("ignores surrounding text from map snippets", () => {
    expect(parsePastedCoordinatePair("Dropped pin: 47.307322, -122.228453")).toEqual({
      lat: "47.307322",
      lng: "-122.228453",
    });
  });

  it("does not parse incomplete or out-of-range coordinates", () => {
    expect(parsePastedCoordinatePair("47.307322")).toBeNull();
    expect(parsePastedCoordinatePair("95, -122.228453")).toBeNull();
    expect(parsePastedCoordinatePair("47.307322, -190")).toBeNull();
    expect(parsePastedCoordinatePair("not coordinates")).toBeNull();
  });
});

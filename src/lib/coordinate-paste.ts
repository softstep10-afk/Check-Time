export type PastedCoordinatePair = {
  lat: string;
  lng: string;
};

const DECIMAL_COORDINATE_PATTERN = /[-+]?(?:\d+(?:\.\d+)?|\.\d+)/g;

function isValidPastedLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidPastedLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function parsePastedCoordinatePair(value: unknown): PastedCoordinatePair | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;

  const matches = text.match(DECIMAL_COORDINATE_PATTERN);
  if (!matches || matches.length < 2) return null;

  const lat = Number(matches[0]);
  const lng = Number(matches[1]);
  if (!isValidPastedLatitude(lat) || !isValidPastedLongitude(lng)) return null;

  return {
    lat: String(lat),
    lng: String(lng),
  };
}

export const DRIVER_TIME_PROJECT_KIND = "driver_time";

type SettingsRecord = Record<string, unknown>;

export type DriverTimeProjectLike = {
  settings?: SettingsRecord | null;
};

function asSettings(value: unknown): SettingsRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as SettingsRecord) }
    : {};
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function isDriverTimeProject(project: DriverTimeProjectLike | null | undefined): boolean {
  const settings = asSettings(project?.settings);
  return (
    settings.projectKind === DRIVER_TIME_PROJECT_KIND ||
    settings.project_kind === DRIVER_TIME_PROJECT_KIND ||
    settings.driver_time_project === true ||
    settings.gps_not_required === true ||
    settings.gpsNotRequired === true
  );
}

export function isGpsWarningSuppressedForProject(
  project: DriverTimeProjectLike | null | undefined,
): boolean {
  return isDriverTimeProject(project);
}

export function readDriverTimeProjectFlag(value: unknown): boolean {
  if (typeof value === "string" && value === DRIVER_TIME_PROJECT_KIND) return true;
  return readBoolean(value);
}

export function mergeDriverTimeProjectSettings(
  settings: unknown,
  enabled: boolean,
): SettingsRecord {
  const next = asSettings(settings);

  if (enabled) {
    return {
      ...next,
      projectKind: DRIVER_TIME_PROJECT_KIND,
      gpsNotRequired: true,
    };
  }

  if (next.projectKind === DRIVER_TIME_PROJECT_KIND) {
    delete next.projectKind;
  }
  if (next.project_kind === DRIVER_TIME_PROJECT_KIND) {
    delete next.project_kind;
  }
  if (next.driver_time_project === true) {
    delete next.driver_time_project;
  }
  if (next.gps_not_required === true) {
    delete next.gps_not_required;
  }
  if (next.gpsNotRequired === true) {
    delete next.gpsNotRequired;
  }

  return next;
}

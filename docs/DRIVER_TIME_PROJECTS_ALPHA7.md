# Driver Time Projects Alpha-7

Driver time projects are service/work projects for drivers who start the day from stores, suppliers, or other moving locations.

## What Changed

- Owner/manager can mark a project as a driver time project.
- The marker is stored in existing `projects.settings` as `projectKind: "driver_time"` and `gpsNotRequired: true`.
- No database schema change, migration, RLS change, or Storage policy change is required.
- Driver time projects can be saved without site GPS coordinates.
- Workers can clock in/out on these projects without GPS.
- Time still counts normally through the existing clock-in/clock-out events.
- Owner/manager can still see active driver shifts and hours.

## GPS Behavior

- Driver time projects show `GPS не требуется`.
- No scary `No GPS` warning is shown for this project type.
- Raw time event metadata may still record that GPS was unavailable.
- Normal construction projects keep existing GPS requirements and no-GPS warnings.

## What Was Not Changed

- Payroll calculation is unchanged.
- Shift calculation is unchanged.
- GPS/geofence logic for normal projects is unchanged.
- Archive/trash logic is unchanged.
- No production data is created automatically.
- No Sanya-specific hardcode is used.

## Manual QA

- Create a driver work project, for example `Водитель — Sanya`.
- Enable the driver time project checkbox.
- Save without GPS coordinates.
- Log in as the driver and clock in without GPS.
- Confirm owner/manager sees the active shift/time.
- Confirm no `No GPS` warning appears for the driver time project.
- Confirm checkout works and hours are counted.
- Confirm a normal construction project without GPS still shows the existing warning.

import { describe, it, expect } from "vitest";
import { normalizeValue } from "../BulkImportUsersDialog";

// Mirrors the actual units configured in Settings → Units (per the reported bug)
const existingUnits = [
  { id: "1", name: "African Energy Ltd" },
  { id: "2", name: "African Energy Ltd Stations - Dar" },
  { id: "3", name: "African Energy Ltd Stations - Upcountry" },
  { id: "4", name: "Amsons Foundation" },
  { id: "5", name: "Camel Cement" },
  { id: "6", name: "Camel Concrete" },
  { id: "7", name: "Camel Gas" },
  { id: "8", name: "Camel Oil" },
  { id: "9", name: "Camel Polybags" },
  { id: "10", name: "Camel Wheat Flour" },
  { id: "11", name: "Mozambique" },
];

function matchUnit(csvUnitName: string) {
  const unitMap = new Map(existingUnits.map((u) => [normalizeValue(u.name), u]));
  return unitMap.get(normalizeValue(csvUnitName)) ?? null;
}

describe("bulk import unit validation", () => {
  it.each([
    "African Energy Ltd",
    "African Energy Ltd Stations - Dar",
    "Camel Oil",
    "Camel Gas",
    "Mozambique",
  ])("matches existing unit '%s' exactly", (name) => {
    expect(matchUnit(name)?.name).toBe(name);
  });

  it.each([
    ["camel oil", "Camel Oil"],
    [" Camel Oil", "Camel Oil"],
    ["CAMEL OIL", "Camel Oil"],
    ["Camel    Oil", "Camel Oil"],
  ])("matches case/whitespace variant '%s' to '%s'", (variant, expected) => {
    expect(matchUnit(variant)?.name).toBe(expected);
  });

  it("rejects a genuinely invalid unit", () => {
    expect(matchUnit("Invalid Test Unit XYZ")).toBeNull();
  });
});

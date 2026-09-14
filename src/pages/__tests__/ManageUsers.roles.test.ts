import { describe, it, expect } from "vitest";
import { toRoleValue } from "../ManageUsers";

describe("Role dropdown source of truth (toRoleValue)", () => {
  it("collapses known built-in aliases to their canonical value", () => {
    expect(toRoleValue("Super Admin")).toBe("super_admin");
    expect(toRoleValue("super_admin")).toBe("super_admin");
    expect(toRoleValue("Team Member")).toBe("assigned_person");
    expect(toRoleValue("Technician")).toBe("assigned_person");
    expect(toRoleValue("HOD")).toBe("hod");
    expect(toRoleValue("PC")).toBe("PC");
    expect(toRoleValue("Admin South")).toBe("Admin South");
  });

  it("passes through a custom role name unchanged instead of dropping it", () => {
    // These are real custom roles created via Settings -> Roles & Permissions
    // that previously vanished from the Create/Edit User dropdown because
    // toRoleValue returned null for anything not in the fixed alias map.
    expect(toRoleValue("IT Lead")).toBe("IT Lead");
    expect(toRoleValue("Manager")).toBe("Manager");
    expect(toRoleValue("Camel Cement Right")).toBe("Camel Cement Right");
    expect(toRoleValue("Test")).toBe("Test");
    expect(toRoleValue("Production Manager")).toBe("Production Manager");
  });

  it("building roleOptions from a mixed roles list keeps every role and de-dupes aliases", () => {
    const rolesList = ["user", "Super Admin", "Admin", "IT Lead", "Manager", "Team Member", "Camel Cement Right", "Test"];
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const name of rolesList) {
      const value = toRoleValue(name);
      if (seen.has(value)) continue;
      seen.add(value);
      opts.push({ value, label: name });
    }
    expect(opts.map((o) => o.label)).toEqual([
      "user", "Super Admin", "Admin", "IT Lead", "Manager", "Team Member", "Camel Cement Right", "Test",
    ]);
    expect(opts).toHaveLength(8);
  });

  it("de-dupes a display-label row against an enum-key row for the same built-in role", () => {
    const rolesList = ["super_admin", "Super Admin"];
    const seen = new Set<string>();
    const values = rolesList.map(toRoleValue).filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
    expect(values).toEqual(["super_admin"]);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  allPermissionValues,
  staffPermissionValues,
} from "../src/lib/access-control.ts";
import {
  designationSchema,
  userProvisionSchema,
} from "../src/lib/validation/business.ts";

const user = {
  email: "staff@example.com",
  name: "Staff Member",
  role: "OUTLET_USER",
  outletIds: [],
  active: true,
};

test("user access accepts every staff permission, including uniform deductions", () => {
  const result = userProvisionSchema.safeParse({
    ...user,
    permissions: staffPermissionValues,
  });

  assert.equal(result.success, true);
});

test("MAIN_ADMIN access accepts the full permission set", () => {
  const result = userProvisionSchema.safeParse({
    ...user,
    role: "MAIN_ADMIN",
    permissions: allPermissionValues,
  });

  assert.equal(result.success, true);
});

test("designations cannot grant MAIN_ADMIN-only permissions", () => {
  const result = designationSchema.safeParse({
    name: "Outlet Manager",
    description: "",
    permissions: ["audit.read"],
  });

  assert.equal(result.success, false);
});

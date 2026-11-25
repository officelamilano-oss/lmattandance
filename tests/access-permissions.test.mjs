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

test("user access accepts directly grantable staff permissions", () => {
  const result = userProvisionSchema.safeParse({
    ...user,
    permissions: staffPermissionValues.filter(
      (permission) => permission !== "about.read",
    ),
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

test("designations can grant About Us access", () => {
  const result = designationSchema.safeParse({
    name: "Outlet Manager",
    description: "",
    permissions: ["about.read"],
  });

  assert.equal(result.success, true);
});

test("About Us access cannot be granted directly to an outlet user", () => {
  const result = userProvisionSchema.safeParse({
    ...user,
    permissions: ["about.read"],
  });

  assert.equal(result.success, false);
});

test("About Us access can be granted to a user through a designation", () => {
  const result = userProvisionSchema.safeParse({
    ...user,
    designationId: "507f1f77bcf86cd799439011",
    permissions: ["about.read"],
  });

  assert.equal(result.success, true);
});

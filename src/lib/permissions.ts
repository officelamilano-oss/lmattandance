import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import type { Permission, UserDocument, UserRole } from "@/lib/models";
import {
  allPermissionValues,
  legacyOutletDefaultPermissions,
} from "@/lib/access-control";

export interface Actor { id: ObjectId; email: string; name: string; role: UserRole; outletIds: ObjectId[]; permissions: Permission[] }

export const getActor = cache(async (): Promise<Actor | null> => {
  await connection();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;
  const db = await getDb();
  const user = await db.collection<UserDocument>("users").findOne({ emailNormalized: email, active: true });
  if (!user) return null;
  const permissions = user.role === "MAIN_ADMIN"
    ? allPermissionValues
    : user.designationId || user.permissionsCustomized
      ? user.permissions ?? []
      : user.role === "OUTLET_USER"
        ? legacyOutletDefaultPermissions
        : user.permissions ?? [];
  return { id: user._id, email, name: user.name, role: user.role, outletIds: user.outletIds, permissions };
});

export async function requireActor(permission?: Permission): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (permission && !actor.permissions.includes(permission)) redirect("/unauthorized");
  return actor;
}

export function hasPermission(actor: Actor, permission: Permission) { return actor.role === "MAIN_ADMIN" || actor.permissions.includes(permission); }

export function assertOutletAccess(actor: Actor, outletId: ObjectId | string) {
  if (actor.role !== "MAIN_ADMIN" && !actor.outletIds.some((allowed) => allowed.toHexString() === String(outletId))) throw new Error("OUTLET_FORBIDDEN");
}

export function scopedOutletQuery(actor: Actor, requestedId?: string) {
  if (actor.role === "MAIN_ADMIN") return requestedId ? { _id: new ObjectId(requestedId) } : {};
  if (requestedId) {
    assertOutletAccess(actor, requestedId);
    return { _id: new ObjectId(requestedId) };
  }
  return { _id: { $in: actor.outletIds } };
}
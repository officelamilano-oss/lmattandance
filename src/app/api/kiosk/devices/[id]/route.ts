import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/permissions";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type { KioskDeviceDocument } from "@/lib/models";

const updateDeviceSchema = z.object({
  label: z.string().trim().min(2).max(80),
});

async function getAdminAccess(context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor)
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  if (actor.role !== "MAIN_ADMIN")
    return { response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  const { id } = await context.params;
  if (!ObjectId.isValid(id))
    return {
      response: NextResponse.json(
        { error: "Invalid kiosk device ID." },
        { status: 400 },
      ),
    };
  return { actor, id, db: await getDb() };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const access = await getAdminAccess(context);
    if (access.response) return access.response;
    const input = updateDeviceSchema.parse(
      await readJson<Record<string, unknown>>(request),
    );
    const devices = access.db.collection<KioskDeviceDocument>("kioskDevices");
    const device = await devices.findOne({ _id: new ObjectId(access.id) });
    if (!device) throw new Error("NOT_FOUND");
    await devices.updateOne(
      { _id: device._id },
      { $set: { label: input.label, updatedAt: new Date() } },
    );
    await writeAudit({
      actorId: access.actor.id,
      actorEmail: access.actor.email,
      action: "KIOSK_DEVICE_UPDATED",
      entityType: "kioskDevice",
      entityId: access.id,
      outletId: device.outletId,
      changes: {
        label: { before: device.label, after: input.label },
      },
    });
    return NextResponse.json({ ok: true, label: input.label });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const access = await getAdminAccess(context);
    if (access.response) return access.response;
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const devices = access.db.collection<KioskDeviceDocument>("kioskDevices");
        const device = await devices.findOne(
          { _id: new ObjectId(access.id) },
          { session },
        );
        if (!device) throw new Error("NOT_FOUND");
        await devices.deleteOne({ _id: device._id }, { session });
        await writeAudit(
          {
            actorId: access.actor.id,
            actorEmail: access.actor.email,
            action: "KIOSK_DEVICE_DELETED",
            entityType: "kioskDevice",
            entityId: access.id,
            outletId: device.outletId,
            changes: {
              label: { before: device.label, after: null },
            },
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

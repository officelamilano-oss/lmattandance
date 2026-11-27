import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError, assertSameOrigin } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import type { KioskDeviceDocument } from "@/lib/models";
import {
  createUniqueKioskPin,
  decryptKioskPin,
  encryptKioskPin,
} from "@/lib/kiosk-auth";

async function getAdminDevice(context: { params: Promise<{ id: string }> }) {
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
  const db = await getDb();
  const device = await db
    .collection<KioskDeviceDocument>("kioskDevices")
    .findOne({ _id: new ObjectId(id), active: true });
  if (!device) return { response: NextResponse.json({ error: "Record not found." }, { status: 404 }) };
  return { actor, db, device, id };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await getAdminDevice(context);
    if (access.response) return access.response;
    if (!access.device.pinEncrypted)
      return NextResponse.json(
        { error: "This PIN cannot be shown. Reset it to generate a recoverable PIN." },
        { status: 409 },
      );
    return NextResponse.json({
      pin: decryptKioskPin(access.device.pinEncrypted),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const access = await getAdminDevice(context);
    if (access.response) return access.response;

    const { pin, pinHash } = await createUniqueKioskPin(access.db);
    const updated = await access.db.collection<KioskDeviceDocument>("kioskDevices").updateOne(
      { _id: access.device._id, active: true },
      {
        $set: {
          pinHash,
          pinEncrypted: encryptKioskPin(pin),
          updatedAt: new Date(),
        },
        $unset: { tokenHash: "" },
      },
    );
    if (updated.modifiedCount !== 1)
      throw new Error("Kiosk PIN could not be updated. Refresh and try again.");
    await writeAudit({
      actorId: access.actor.id,
      actorEmail: access.actor.email,
      action: "KIOSK_PIN_ROTATED",
      entityType: "kioskDevice",
      entityId: access.id,
      outletId: access.device.outletId,
    });
    return NextResponse.json({ pin });
  } catch (error) {
    return apiError(error);
  }
}

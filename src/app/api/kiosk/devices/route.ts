import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import {
  createUniqueKioskPin,
  encryptKioskPin,
} from "@/lib/kiosk-auth";
import type { KioskDeviceDocument } from "@/lib/models";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";

const createDeviceSchema = z.object({
  outletId: z.string().regex(/^[a-f\d]{24}$/i),
  label: z.string().trim().min(2).max(80),
});

async function requireMainAdmin() {
  const actor = await getActor();
  if (!actor) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  if (actor.role !== "MAIN_ADMIN")
    return { response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  return { actor };
}

export async function GET() {
  try {
    const access = await requireMainAdmin();
    if (access.response) return access.response;
    const db = await getDb();
    const [devices, outlets] = await Promise.all([
      db
        .collection<KioskDeviceDocument>("kioskDevices")
        .find({})
        .sort({ createdAt: -1 })
        .toArray(),
      db
        .collection<OutletSettingsDocument>("outlets")
        .find({ active: true }, { projection: { code: 1, name: 1 } })
        .sort({ sort_order: 1, code: 1 })
        .toArray(),
    ]);
    const outletById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );
    return NextResponse.json({
      devices: devices.map((device) => ({
        id: device._id.toHexString(),
        outletId: device.outletId.toHexString(),
        outletCode: outletById.get(device.outletId.toHexString())?.code ?? "",
        outletName: outletById.get(device.outletId.toHexString())?.name ?? "",
        label: device.label,
        active: device.active,
        hasPin: Boolean(device.pinHash),
        canShowPin: Boolean(device.pinEncrypted),
        createdAt: device.createdAt.toISOString(),
        lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
      })),
      outlets: outlets.map((outlet) => ({
        id: outlet._id.toHexString(),
        code: outlet.code,
        name: outlet.name,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireMainAdmin();
    if (access.response) return access.response;
    const input = createDeviceSchema.parse(
      await readJson<Record<string, unknown>>(request),
    );
    const db = await getDb();
    const outletId = new ObjectId(input.outletId);
    const outlet = await db
      .collection<OutletSettingsDocument>("outlets")
      .findOne({ _id: outletId, active: true });
    if (!outlet)
      return NextResponse.json(
        { error: "Choose an active outlet." },
        { status: 400 },
      );
    const { pin, pinHash } = await createUniqueKioskPin(db);
    const now = new Date();
    const device: KioskDeviceDocument = {
      _id: new ObjectId(),
      outletId,
      label: input.label,
      pinHash,
      pinEncrypted: encryptKioskPin(pin),
      active: true,
      createdBy: access.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<KioskDeviceDocument>("kioskDevices").insertOne(device);
    await writeAudit({
      actorId: access.actor.id,
      actorEmail: access.actor.email,
      action: "KIOSK_DEVICE_CREATED",
      entityType: "kioskDevice",
      entityId: device._id.toHexString(),
      outletId,
      changes: {
        label: { before: null, after: device.label },
      },
    });
    return NextResponse.json(
      {
        device: {
          id: device._id.toHexString(),
          outletCode: outlet.code,
          outletName: outlet.name,
          label: device.label,
        },
        pin,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

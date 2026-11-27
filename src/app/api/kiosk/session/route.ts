import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import type { KioskDeviceDocument } from "@/lib/models";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";
import {
  authorizeKioskDevice,
  consumeKioskPinAttempt,
  createKioskSessionToken,
  hashKioskPin,
  KIOSK_SESSION_COOKIE,
  KIOSK_SESSION_MAX_AGE_SECONDS,
} from "@/lib/kiosk-auth";

const pinSchema = z.object({
  pin: z.string().regex(/^\d{8}$/),
});

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(KIOSK_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: KIOSK_SESSION_MAX_AGE_SECONDS,
    path: "/api/kiosk",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function GET(request: Request) {
  try {
    const device = await authorizeKioskDevice(request);
    if (!device)
      return NextResponse.json(
        { error: "Kiosk setup is required." },
        { status: 401 },
      );
    const db = await getDb();
    const outlet = await db
      .collection<OutletSettingsDocument>("outlets")
      .findOne(
        { _id: device.outletId, active: true },
        { projection: { code: 1, name: 1 } },
      );
    if (!outlet)
      return NextResponse.json(
        { error: "This kiosk outlet is inactive." },
        { status: 401 },
      );
    return NextResponse.json({
      device: { label: device.label },
      outlet: { code: outlet.code, name: outlet.name },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { pin } = pinSchema.parse(
      await readJson<Record<string, unknown>>(request),
    );
    const db = await getDb();
    if (!(await consumeKioskPinAttempt(db, request)))
      return NextResponse.json(
        { error: "Too many PIN attempts. Wait 15 minutes and try again." },
        { status: 429, headers: { "Retry-After": "900" } },
      );

    const device = await db
      .collection<KioskDeviceDocument>("kioskDevices")
      .findOne({ pinHash: hashKioskPin(pin), active: true });
    if (!device)
      return NextResponse.json(
        { error: "Incorrect kiosk PIN. Check the code with your administrator." },
        { status: 401 },
      );
    if (!device.pinHash)
      throw new Error("Kiosk PIN credential is missing.");
    const outlet = await db
      .collection<OutletSettingsDocument>("outlets")
      .findOne(
        { _id: device.outletId, active: true },
        { projection: { code: 1, name: 1 } },
      );
    if (!outlet)
      return NextResponse.json(
        { error: "This kiosk outlet is inactive. Contact an administrator." },
        { status: 401 },
      );

    await db.collection<KioskDeviceDocument>("kioskDevices").updateOne(
      { _id: device._id, active: true },
      { $set: { lastUsedAt: new Date() } },
    );
    const response = NextResponse.json({
      device: { label: device.label },
      outlet: { code: outlet.code, name: outlet.name },
    });
    setSessionCookie(
      response,
      createKioskSessionToken(device._id.toHexString(), device.pinHash),
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(KIOSK_SESSION_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/api/kiosk",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}

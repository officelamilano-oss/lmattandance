import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { apiError, readJson } from "@/lib/http";
import { updateOutletDocument } from "@/lib/outlet-mutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlets." },
        { status: 403 },
      );
    const { id } = await params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid outlet ID." }, { status: 400 });
    const result = await updateOutletDocument(
      new ObjectId(id),
      await readJson<unknown>(request),
      actor,
    );
    if (result.confirmationRequiredCount !== undefined)
      return NextResponse.json(
        {
          error: `Confirm the update of ${result.confirmationRequiredCount} employee codes before renaming this outlet.`,
          employeeCodeUpdateCount: result.confirmationRequiredCount,
        },
        { status: 409 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

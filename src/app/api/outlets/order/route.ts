import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { apiError, readJson } from "@/lib/http";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";
import { getActor } from "@/lib/permissions";

const orderActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SAVE_DRAFT"),
    outletIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100),
  }),
  z.object({ action: z.literal("PUBLISH") }),
  z.object({ action: z.literal("DISCARD") }),
]);

export async function PATCH(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlet order." },
        { status: 403 },
      );

    const input = orderActionSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const outlets = db.collection<OutletSettingsDocument>("outlets");
        const current = await outlets
          .find(
            {},
            {
              session,
              projection: {
                _id: 1,
                draft_sort_order: 1,
                sort_order: 1,
              },
            },
          )
          .toArray();
        const now = new Date();

        if (input.action === "SAVE_DRAFT") {
          const currentIds = new Set(
            current.map((outlet) => outlet._id.toHexString()),
          );
          const requestedIds = new Set(input.outletIds);
          if (
            requestedIds.size !== input.outletIds.length ||
            requestedIds.size !== currentIds.size ||
            [...requestedIds].some((id) => !currentIds.has(id))
          )
            throw new Error("OUTLET_ORDER_DRAFT_INVALID");

          for (const [sortOrder, id] of input.outletIds.entries())
            await outlets.updateOne(
              { _id: new ObjectId(id) },
              { $set: { draft_sort_order: sortOrder, updatedAt: now } },
              { session },
            );
          await writeAudit(
            {
              actorId: actor.id,
              actorEmail: actor.email,
              action: "OUTLET_ORDER_DRAFT_SAVED",
              entityType: "outlet_order",
              entityId: "all",
              changes: {
                draftOrder: {
                  before: current
                    .filter(
                      (outlet) =>
                        typeof outlet.draft_sort_order === "number",
                    )
                    .sort(
                      (left, right) =>
                        (left.draft_sort_order ?? 0) -
                        (right.draft_sort_order ?? 0),
                    )
                    .map((outlet) => outlet._id.toHexString()),
                  after: input.outletIds,
                },
              },
            },
            session,
          );
          return;
        }

        const draft = current
          .filter(
            (outlet) => typeof outlet.draft_sort_order === "number",
          )
          .sort(
            (left, right) =>
              (left.draft_sort_order ?? 0) -
              (right.draft_sort_order ?? 0),
          );
        if (input.action === "PUBLISH") {
          if (
            draft.length !== current.length ||
            new Set(draft.map((outlet) => outlet.draft_sort_order)).size !==
              draft.length
          )
            throw new Error("OUTLET_ORDER_DRAFT_INVALID");
          for (const [sortOrder, outlet] of draft.entries())
            await outlets.updateOne(
              { _id: outlet._id },
              {
                $set: { sort_order: sortOrder, updatedAt: now },
                $unset: { draft_sort_order: "" },
              },
              { session },
            );
          await writeAudit(
            {
              actorId: actor.id,
              actorEmail: actor.email,
              action: "OUTLET_ORDER_PUBLISHED",
              entityType: "outlet_order",
              entityId: "all",
              changes: {
                liveOrder: {
                  before: current
                    .sort(
                      (left, right) =>
                        (left.sort_order ?? 0) - (right.sort_order ?? 0),
                    )
                    .map((outlet) => outlet._id.toHexString()),
                  after: draft.map((outlet) => outlet._id.toHexString()),
                },
              },
            },
            session,
          );
          return;
        }

        if (draft.length)
          await outlets.updateMany(
            { draft_sort_order: { $exists: true } },
            {
              $unset: { draft_sort_order: "" },
              $set: { updatedAt: now },
            },
            { session },
          );
        if (draft.length)
          await writeAudit(
            {
              actorId: actor.id,
              actorEmail: actor.email,
              action: "OUTLET_ORDER_DRAFT_DISCARDED",
              entityType: "outlet_order",
              entityId: "all",
              changes: {
                draftOrder: {
                  before: draft.map((outlet) => outlet._id.toHexString()),
                  after: null,
                },
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

import { NextResponse } from "next/server";

function retiredResponse() {
  return NextResponse.json(
    {
      error:
        "PIN-based kiosk devices are no longer supported. Sign in to the workspace and use /kiosk.",
    },
    { status: 410 },
  );
}

export async function PATCH() {
  return retiredResponse();
}

export async function DELETE() {
  return retiredResponse();
}

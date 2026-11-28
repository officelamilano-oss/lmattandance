import { NextResponse } from "next/server";

function retiredResponse() {
  return NextResponse.json(
    {
      error:
        "Kiosk PINs are no longer supported. Sign in to the workspace and use /kiosk.",
    },
    { status: 410 },
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}

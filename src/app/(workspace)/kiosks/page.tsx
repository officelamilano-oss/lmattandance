import "../../globals.css";
import { KioskDeviceManager } from "@/components/kiosk-device-manager";
import { requireActor } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function KiosksPage() {
  const actor = await requireActor("outlets.manage");
  if (actor.role !== "MAIN_ADMIN") redirect("/unauthorized");
  return <KioskDeviceManager />;
}

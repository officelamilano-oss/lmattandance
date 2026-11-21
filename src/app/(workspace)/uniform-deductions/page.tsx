import "../../globals.css";
import { UniformDeductionPanel } from "@/components/uniform-deduction-panel";
import { requireActor } from "@/lib/permissions";

export default async function UniformDeductionsPage() {
  const actor = await requireActor("uniforms.manage");
  return (
    <UniformDeductionPanel
      canExport={actor.permissions.includes("reports.export")}
      cacheScope={actor.email}
    />
  );
}

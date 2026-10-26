import { WorkspacePanel } from "@/components/workspace-panel";
import { WorkspacePageBoundary } from "@/components/workspace-page-boundary";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getActor } from "@/lib/permissions";

export default function DashboardPage() {
  return (
    <WorkspacePageBoundary>
      <DashboardContent />
    </WorkspacePageBoundary>
  );
}

async function DashboardContent() {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.includes("dashboard.read")) {
    const firstAllowed = [
      ["attendance.read", "/attendance"], ["salary.read", "/salary"],
      ["employees.read", "/employees"], ["advances.read", "/advances"],
      ["outlets.manage", "/outlets"], ["access.manage", "/access"],
      ["reports.export", "/reports"], ["audit.read", "/active-logs"],
      ["settings.manage", "/settings"],
    ].find(([permission]) => actor.permissions.includes(permission as never));
    if (firstAllowed) redirect(firstAllowed[1]);
    redirect("/unauthorized");
  }
  return <WorkspacePanel section="dashboard" user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }} />;
}
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmployeeDetail } from "@/components/employee-detail";
import { WorkspacePageBoundary } from "@/components/workspace-page-boundary";
import { requireActor } from "@/lib/permissions";

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <WorkspacePageBoundary>
      <EmployeeDetailContent params={params} />
    </WorkspacePageBoundary>
  );
}

async function EmployeeDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const actor = await requireActor("employees.read");
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return (
    <EmployeeDetail
      id={id}
      canEdit={actor.permissions.includes("employees.update")}
      mainAdmin={actor.role === "MAIN_ADMIN"}
      canViewSensitive={actor.role !== "OUTLET_USER"}
    />
  );
}

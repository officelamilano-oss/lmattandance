import "../../../globals.css";
import { notFound } from "next/navigation";
import { EmployeeDetail } from "@/components/employee-detail";
import { requireActor } from "@/lib/permissions";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor("employees.read");
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return (
    <EmployeeDetail
      id={id}
      cacheScope={actor.email}
      canEdit={actor.permissions.includes("employees.update")}
      mainAdmin={actor.role === "MAIN_ADMIN"}
      canViewSensitive={actor.role !== "OUTLET_USER"}
      canManageUniforms={actor.permissions.includes("uniforms.manage")}
      canManageShift={actor.permissions.includes("employees.shift.manage")}
      canManageFace={actor.permissions.includes("employees.face.manage")}
    />
  );
}

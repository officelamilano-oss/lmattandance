import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { getActor } from "@/lib/permissions";
import { WorkspaceLoading } from "@/components/workspace-loading";

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>
    </Suspense>
  );
}

async function AuthenticatedWorkspace({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <AppShell user={{ name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions }}>{children}</AppShell>;
}
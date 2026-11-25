import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getActor } from "@/lib/permissions";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>
    </Suspense>
  );
}

async function AuthenticatedWorkspace({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return (
    <AppShell
      user={{
        name: actor.name,
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions,
      }}
    >
      {children}
    </AppShell>
  );
}
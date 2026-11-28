import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { getActor, hasPermission } from "@/lib/permissions";

export default function KioskLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <AuthenticatedKiosk>{children}</AuthenticatedKiosk>
    </Suspense>
  );
}

async function AuthenticatedKiosk({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!hasPermission(actor, "attendance.write")) redirect("/unauthorized");

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

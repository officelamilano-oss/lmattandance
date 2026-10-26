import { WorkspacePanel, type WorkspaceSection } from "@/components/workspace-panel";
import type { Permission } from "@/lib/models";
import { requireActor } from "@/lib/permissions";
import { WorkspacePageBoundary } from "@/components/workspace-page-boundary";
import { connection } from "next/server";

export function WorkspaceSectionPage({
  section,
  permission,
  mainAdminOnly = false,
}: {
  section: WorkspaceSection;
  permission: Permission;
  mainAdminOnly?: boolean;
}) {
  return (
    <WorkspacePageBoundary>
      <AuthorizedWorkspaceSection
        section={section}
        permission={permission}
        mainAdminOnly={mainAdminOnly}
      />
    </WorkspacePageBoundary>
  );
}

async function AuthorizedWorkspaceSection({
  section,
  permission,
  mainAdminOnly,
}: {
  section: WorkspaceSection;
  permission: Permission;
  mainAdminOnly: boolean;
}) {
  await connection();
  const actor = await requireActor(permission);
  if (mainAdminOnly && actor.role !== "MAIN_ADMIN") return null;

  return (
    <WorkspacePanel
      section={section}
      user={{
        name: actor.name,
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions,
      }}
    />
  );
}

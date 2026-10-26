import { Suspense, type ReactNode } from "react";
import { WorkspaceLoading } from "@/components/workspace-loading";

export function WorkspacePageBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceLoading />}>{children}</Suspense>;
}

import { WorkspaceSectionPage } from "@/components/workspace-section-page";

export default function ActiveLogsPage() {
  return <WorkspaceSectionPage section="activeLogs" permission="audit.read" />;
}

import { WorkspaceSectionPage } from "@/components/workspace-section-page";

export default function AttendancePage() {
  return <WorkspaceSectionPage section="attendance" permission="attendance.read" />;
}
import { WorkspaceSectionPage } from "@/components/workspace-section-page";

export default function EmployeesPage() {
  return <WorkspaceSectionPage section="employees" permission="employees.read" />;
}
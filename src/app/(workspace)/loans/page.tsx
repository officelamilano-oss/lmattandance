import { WorkspaceSectionPage } from "@/components/workspace-section-page";

export default function LoansPage() {
  return (
    <WorkspaceSectionPage
      section="loans"
      permission="salary.read"
      mainAdminOnly
    />
  );
}

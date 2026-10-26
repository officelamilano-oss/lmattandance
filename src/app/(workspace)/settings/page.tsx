import { WorkspaceSectionPage } from "@/components/workspace-section-page";

export default function SettingsPage() {
  return <WorkspaceSectionPage section="settings" permission="settings.manage" />;
}
import "../../globals.css";
import { AboutGuide } from "@/components/about-guide";
import { requireActor } from "@/lib/permissions";

export default async function AboutPage() {
  await requireActor("about.read");
  return <AboutGuide />;
}

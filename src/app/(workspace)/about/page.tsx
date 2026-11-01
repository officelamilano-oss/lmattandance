import { redirect } from "next/navigation";
import "../../globals.css";
import { AboutGuide } from "@/components/about-guide";
import { getActor } from "@/lib/permissions";

export default async function AboutPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <AboutGuide />;
}

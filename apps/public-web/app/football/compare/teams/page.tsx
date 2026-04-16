import { redirect } from "next/navigation";

export default function FootballCompareTeamsPage() {
  redirect("/compare/teams?sport=football");
}
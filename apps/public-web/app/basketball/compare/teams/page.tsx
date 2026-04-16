import { redirect } from "next/navigation";

export default function BasketballCompareTeamsPage() {
  redirect("/compare/teams?sport=basketball");
}
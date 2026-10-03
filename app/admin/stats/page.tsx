import { redirect } from "next/navigation";

/** Legacy path → unified console. */
export default function Redirect() {
  redirect("/console/stats");
}

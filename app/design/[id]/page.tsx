import { notFound } from "next/navigation";
import { getBlueprint } from "@/lib/blueprint";
import Workspace from "./Workspace";

export const dynamic = "force-dynamic";

export default async function DesignerWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bp = getBlueprint(id);
  if (!bp) notFound();
  return <Workspace initialBlueprint={bp} />;
}

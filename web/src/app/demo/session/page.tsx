import { notFound } from "next/navigation";
import { DemoSessionLauncher } from "@/components/DemoSessionLauncher";

export default function DemoSessionPage() {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== "1") notFound();
  return <DemoSessionLauncher />;
}

import type { ReactNode } from "react";
import { ScreenEntrance } from "@/components/ScreenEntrance";

export default function NewHostLayout({ children }: { children: ReactNode }) {
  return <ScreenEntrance>{children}</ScreenEntrance>;
}

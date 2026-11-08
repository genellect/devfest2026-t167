import { Suspense } from "react";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { Loading } from "@/components/ui";
export default function Home() { return <Suspense fallback={<Loading />}><HomeDashboard /></Suspense>; }

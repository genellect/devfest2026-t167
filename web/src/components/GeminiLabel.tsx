import Image from "next/image";
export function GeminiLabel({ source, label = "Geminiの分析" }: { source?: string; label?: string }) {
  return <span className="gemini-label"><Image src="/brand/gemini.svg" alt="" width={24} height={24} /><span>{label}</span>{source === "mock" && <span className="gemini-label__demo">デモ</span>}</span>;
}

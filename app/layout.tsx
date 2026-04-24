import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "UMU Learning Library",
  description: "Gamecore-based learning journey platform (PRD v0.1)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>
        <div className="flex flex-col min-h-screen">
          <header className="border-b border-border bg-panel/80 backdrop-blur px-4 py-2 flex items-center gap-6 text-sm">
            <Link href="/" className="font-bold text-accent">UMU Learning Library</Link>
            <nav className="flex items-center gap-4 text-muted">
              <Link href="/design" className="hover:text-text" data-test-id="nav-design">设计阶段</Link>
              <Link href="/learn" className="hover:text-text" data-test-id="nav-learn">学员</Link>
              <Link href="/admin" className="hover:text-text" data-test-id="nav-admin">运维后台</Link>
            </nav>
            <LlmModeBadge />
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}

/** Truthful LLM mode indicator. Matches the exact predicate in
 *  `lib/llm/index.ts`: mock is active when `LLM_MOCK=1` OR when
 *  `ANTHROPIC_API_KEY` is missing. Red-tagged when mock to make it
 *  obvious (no more "LLM: real" while everything is actually faked). */
function LlmModeBadge() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const forcedMock = process.env.LLM_MOCK === "1";
  const mock = !hasKey || forcedMock;
  const reason = forcedMock ? "LLM_MOCK=1" : !hasKey ? "no ANTHROPIC_API_KEY" : "";
  return (
    <span
      className={`ml-auto text-xs ${mock ? "text-bad font-semibold" : "text-good"}`}
      title={reason || "Anthropic API key detected"}
    >
      PRD v0.1 · {mock ? `LLM: MOCK (${reason})` : "LLM: real"}
    </span>
  );
}

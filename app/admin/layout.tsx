import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href={"/admin/tickets"}>Atlan Admin Dashboard</Link>
              <div className="flex items-center gap-4">
                <Link href="/admin/tickets" className="hover:underline">
                  Tickets
                </Link>
                <Link href="/admin/chat" className="hover:underline">
                  AI Agent
                </Link>
              </div>
            </div>
            <AuthButton />
          </div>
        </nav>
        <div className="flex-1 flex flex-col gap-20 max-w-5xl">
          {children}
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <p>
            Atlan Customer Support AI Copilot
          </p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
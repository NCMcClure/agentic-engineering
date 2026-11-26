import { cn } from "../lib/cn";

// On-system: tokens and the system's own component classes only.
export function Card({ className, children }: { className?: string; children: unknown }) {
  return <div className={cn("house-card bg-house-paper text-house-ink", className)}>{children}</div>;
}

export const style = { color: "var(--house-ink)", background: "hsl(var(--house-paper))" };

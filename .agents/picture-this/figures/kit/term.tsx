"use client";
// A word in the prose around a figure that carries the same mark its entity
// has in the picture, so the reader can match the sentence to the drawing.
import type { ReactNode } from "react";
import "./kit.css";
import type { Hue } from "./model";

export function Term({ hue, accent = false, children }: { hue?: Hue; accent?: boolean; children: ReactNode }) {
  const color = hue ? `var(--pt-hue-${hue})` : accent ? "var(--pt-accent-ink)" : undefined;
  return <span className="pt-term" style={color ? { color } : undefined}>{children}</span>;
}

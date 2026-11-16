"use client";
// What the 3D shapes are made of. Four presets, each a colour from the kit's
// tokens and a finish: matte clay, matte black with a soft sheen, frosted
// glass, and the accent. A shape's colour moves with the story exactly as the
// 2D shapes' do: toward the accent for the one thing a beat is about, toward
// the page when the story is elsewhere.
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Color, SRGBColorSpace } from "three";
import type { Look } from "./look";

const LookContext = createContext<Look | null>(null);

export function LookProvider({ value, children }: { value: Look; children: ReactNode }) {
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

/** The colours and lights in force: the kit's tokens for the theme the stage is in. */
export function useLook(): Look {
  const look = useContext(LookContext);
  if (!look) throw new Error("this is drawn inside a <Scene3D>");
  return look;
}

export type Preset = "clay" | "matte" | "glass" | "accent";

/**
 * Where a shape of this material is drawn. Glass is kept on a layer of its
 * own, which the camera sees too, so the ground can shade it apart: glass
 * casts no lamp shadow, and under it the contact shadow is a faint one.
 */
export const layerOf = (preset: Preset): number => (preset === "glass" ? 1 : 0);

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** How far a shape the story is not on moves toward the page: enough to step back, not so far that black stops being black. */
const RECEDE = 0.22;

/**
 * One colour moved toward another by `p`, measured as the screen shows them.
 * Mixed as light instead, a small step from black toward a pale page is
 * already mid-grey.
 */
export function blend(from: string | Color, to: string | Color, p: number): Color {
  const a = new Color(from).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace), b = new Color(to).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const t = clamp(p);
  return new Color().setRGB(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, SRGBColorSpace);
}

/** A preset's colour for a shape in a given state. `lit` and `accent` are 0 to 1, as the figure gives them. */
export function tone(look: Look, preset: Preset, lit = 1, accent = 0): Color {
  const base = preset === "accent" ? look.accent : look[preset];
  const told = accent > 0 && preset !== "accent" ? blend(base, look.accent, accent) : new Color(base);
  return lit < 1 ? blend(told, look.bg, (1 - clamp(lit)) * RECEDE) : told;
}

/** The material of a shape: put it inside a mesh. */
export function Surface({ preset = "clay", lit = 1, accent = 0 }: { preset?: Preset; lit?: number; accent?: number }) {
  const look = useLook();
  const color = tone(look, preset, lit, accent);
  if (preset === "glass") {
    // Frosted, not refracting: see-through enough to show the card below, a
    // clear coat for the edge highlight, a sheen where it turns from the eye.
    // It takes the accent by filling in, since a tint alone would not be seen.
    const opacity = look.glassAlpha * (0.55 + 0.45 * clamp(lit));
    return (
      <meshPhysicalMaterial
        color={color} transparent opacity={opacity + (0.9 - opacity) * clamp(accent)}
        roughness={0.32} metalness={0} clearcoat={1} clearcoatRoughness={0.28}
        sheen={1} sheenRoughness={0.45} sheenColor="#ffffff" specularIntensity={1} envMapIntensity={1.6}
      />
    );
  }
  if (preset === "matte") {
    // A dark matte surface gets a faint sheen so its edges are found; a pale one does not need it.
    const dark = new Color(look.matte).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    return <meshPhysicalMaterial color={color} roughness={0.72} metalness={0} sheen={dark ? 0.5 * (1 - clamp(accent)) : 0} sheenRoughness={0.55} sheenColor="#9a9aa0" />;
  }
  return <meshStandardMaterial color={color} roughness={preset === "accent" ? 0.6 : 0.9 - 0.3 * clamp(accent)} metalness={0} />;
}

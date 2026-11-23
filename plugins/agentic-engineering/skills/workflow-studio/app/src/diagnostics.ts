// Node-anchored compile diagnostics for the canvas: Canvas publishes a
// nodeId → worst-severity map after each compile; BaseNode renders a badge.
import { createContext, useContext } from 'react';

export type NodeSeverity = 'error' | 'warning';

export const DiagnosticsContext = createContext<Map<string, NodeSeverity>>(new Map());

export const useNodeDiagnostic = (nodeId: string): NodeSeverity | undefined =>
  useContext(DiagnosticsContext).get(nodeId);

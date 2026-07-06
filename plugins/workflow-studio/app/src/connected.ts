import { createContext, useContext } from 'react';

/** The set of `${nodeId}:${pinId}` endpoints that currently have a wire. Provided
 *  by the Canvas (recomputed from edges) and read by PinRow so a pin can fill
 *  with its wire color when connected and stay hollow when not. */
export const ConnectedContext = createContext<Set<string>>(new Set());

export const useConnected = () => useContext(ConnectedContext);

export const pinKey = (nodeId: string, pinId: string) => `${nodeId}:${pinId}`;

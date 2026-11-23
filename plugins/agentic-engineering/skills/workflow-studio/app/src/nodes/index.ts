import type { NodeTypes } from '@xyflow/react';
import { catalogList } from '../catalog';
import { BaseNode } from './BaseNode';
import { CommentNode } from './CommentNode';

// Built from the catalog: every kind renders through BaseNode (pins come from
// the catalog), so adding a kind needs no edit here. `comment` is not a catalog
// node — it renders comment-group frames behind the graph.
export const nodeTypes: NodeTypes = {
  ...Object.fromEntries(catalogList().map((d) => [d.kind, BaseNode])),
  comment: CommentNode,
};

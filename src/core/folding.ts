import { Block, BlockKind, FileModel } from './model';

export interface FoldRange {
  start: number;
  end: number;
  /** Structural regions (labels, menus, choices…) — "Fold All Regions" collapses to the story skeleton */
  region: boolean;
  blockKind: BlockKind;
  name?: string;
}

const REGION_KINDS = new Set<BlockKind>(['label', 'menu', 'choice', 'screen', 'init']);

export function computeFoldingRanges(model: FileModel): FoldRange[] {
  const out: FoldRange[] = [];
  const walk = (b: Block): void => {
    if (b.endLine > b.headerLine) {
      out.push({
        start: b.headerLine,
        end: b.endLine,
        region: REGION_KINDS.has(b.kind),
        blockKind: b.kind,
        name: b.name,
      });
    }
    b.children.forEach(walk);
  };
  model.blocks.forEach(walk);
  return out;
}

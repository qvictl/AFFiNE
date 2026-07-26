import type { AffineDNDData } from '@affine/core/types/dnd';

import type { NavigationPanelTreeNodeDropEffect } from '../../tree';

export const docTreeDropEffect: NavigationPanelTreeNodeDropEffect = data => {
  if (data.source.data.entity?.type !== 'doc') {
    return;
  }
  const instruction = data.treeInstruction?.type;
  if (
    instruction === 'reorder-above' ||
    instruction === 'reorder-below' ||
    instruction === 'make-child' ||
    instruction === 'reparent'
  ) {
    return 'move';
  }
  return;
};

export const docTreeCanDrop = (args: {
  source: { data: AffineDNDData['draggable'] };
}) => args.source.data.entity?.type === 'doc';

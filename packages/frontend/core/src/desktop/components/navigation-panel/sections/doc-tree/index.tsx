import { type DropTargetDropEvent, IconButton, toast } from '@affine/component';
import { DocTreeService } from '@affine/core/modules/doc-tree';
import { NavigationPanelService } from '@affine/core/modules/navigation-panel';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import { PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback, useMemo } from 'react';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelTreeRoot } from '../../tree';
import { docTreeCanDrop } from './dnd';
import { NavigationPanelDocTreeNode } from './node';

export const NavigationPanelDocTree = () => {
  const { docTreeService, navigationPanelService } = useServices({
    DocTreeService,
    NavigationPanelService,
  });
  const path = useMemo(() => ['docTree'], []);
  const t = useI18n();

  const docTree = docTreeService.docTree;
  const rootChildren = useLiveData(docTree.rootChildren$);
  const isLoading = useLiveData(docTree.isLoading$);

  const handleCreateDoc = useCallback(() => {
    docTreeService.createDocAndOpen(null);
    navigationPanelService.setCollapsed(path, false);
    track.$.navigationPanel.docs.createDoc();
  }, [docTreeService, navigationPanelService, path]);

  const handleDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>, targetDocId: string) => {
      const entity = data.source.data.entity;
      if (!entity || entity.type !== 'doc') {
        return;
      }
      const instruction = data.treeInstruction?.type;
      try {
        if (instruction === 'reorder-above') {
          docTreeService.moveDocBefore(entity.id, targetDocId);
        } else if (instruction === 'reorder-below') {
          docTreeService.moveDocAfter(entity.id, targetDocId);
        } else if (instruction === 'make-child' || instruction === 'reparent') {
          docTreeService.makeChild(entity.id, targetDocId);
        } else {
          return;
        }
        track.$.navigationPanel.docs.drop({ type: 'doc' });
      } catch (err) {
        toast((err as Error).message);
      }
    },
    [docTreeService]
  );

  return (
    <CollapsibleSection
      path={path}
      title={t['com.affine.rootAppSidebar.docTree']()}
      testId="navigation-panel-doc-tree"
      actions={
        <IconButton
          data-testid="navigation-panel-doc-tree-add-button"
          onClick={handleCreateDoc}
          size="16"
          tooltip={t['com.affine.rootAppSidebar.docTree.add-tooltip']()}
        >
          <PlusIcon />
        </IconButton>
      }
    >
      <NavigationPanelTreeRoot
        placeholder={
          isLoading ? null : (
            <div
              data-testid="navigation-panel-doc-tree-empty"
              style={{ padding: '4px 8px', cursor: 'pointer' }}
              onClick={handleCreateDoc}
            >
              {t['com.affine.rootAppSidebar.docTree.empty']()}
            </div>
          )
        }
      >
        {rootChildren.map(child => (
          <NavigationPanelDocTreeNode
            key={child.id}
            docId={child.id}
            parentPath={path}
            onDrop={handleDrop}
            canDrop={docTreeCanDrop}
          />
        ))}
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};

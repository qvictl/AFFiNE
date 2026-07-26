import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  toast,
} from '@affine/component';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { DocTreeService } from '@affine/core/modules/doc-tree';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { GlobalContextService } from '@affine/core/modules/global-context';
import { NavigationPanelService } from '@affine/core/modules/navigation-panel';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import { useLiveData, useService, useServices } from '@toeverything/infra';
import { useCallback, useMemo } from 'react';

import { NavigationPanelTreeNode } from '../../tree';
import { docTreeDropEffect } from './dnd';
import { useNavigationPanelDocTreeNodeOperations } from './operations';

export const NavigationPanelDocTreeNode = ({
  docId,
  parentPath,
  onDrop,
  canDrop,
}: {
  docId: string;
  parentPath: string[];
  onDrop?: (
    data: DropTargetDropEvent<AffineDNDData>,
    targetDocId: string
  ) => void;
  canDrop?: DropTargetOptions<AffineDNDData>['canDrop'];
}) => {
  const t = useI18n();
  const {
    docsService,
    docTreeService,
    globalContextService,
    docDisplayMetaService,
    featureFlagService,
  } = useServices({
    DocsService,
    DocTreeService,
    GlobalContextService,
    DocDisplayMetaService,
    FeatureFlagService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  const workspaceDialogService = useService(WorkspaceDialogService);

  const active =
    useLiveData(globalContextService.globalContext.docId.$) === docId;
  const path = useMemo(
    () => [...parentPath, `doc-tree-${docId}`],
    [parentPath, docId]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );

  const docRecord = useLiveData(docsService.list.doc$(docId));
  const DocIcon = useLiveData(docDisplayMetaService.icon$(docId, {}));
  const docTitle = useLiveData(docDisplayMetaService.title$(docId));
  const isInTrash = useLiveData(docRecord?.trash$);
  const isTemplate = useLiveData(docRecord?.property$('isTemplate'));
  const enableEmojiIcon = useLiveData(
    featureFlagService.flags.enable_emoji_doc_icon.$
  );

  const children = useLiveData(
    useMemo(
      () => docTreeService.docTree.childrenOf$(docId),
      [docTreeService, docId]
    )
  );

  const Icon = useCallback(
    ({ className }: { className?: string }) => {
      return <DocIcon className={className} />;
    },
    [DocIcon]
  );

  const dndData = useMemo(
    () =>
      ({
        draggable: {
          entity: { type: 'doc', id: docId },
          from: { at: 'navigation-panel:doc-tree:node', docId },
        },
        dropTarget: {
          at: 'navigation-panel:doc-tree:node',
          docId,
        },
      }) satisfies AffineDNDData,
    [docId]
  );

  const handleRename = useAsyncCallback(
    async (newName: string) => {
      await docsService.changeDocTitle(docId, newName);
      track.$.navigationPanel.organize.renameOrganizeItem({ type: 'doc' });
    },
    [docId, docsService]
  );

  const handleDrop = useCallback(
    (data: DropTargetDropEvent<AffineDNDData>) => {
      if (data.source.data.entity?.type !== 'doc') {
        toast(t['com.affine.rootAppSidebar.docTree.doc-only']());
        return;
      }
      onDrop?.(data, docId);
    },
    [docId, onDrop, t]
  );

  const operations = useNavigationPanelDocTreeNodeOperations(
    docId,
    useMemo(
      () => ({
        openInfoModal: () => workspaceDialogService.open('doc-info', { docId }),
        openNodeCollapsed: () => setCollapsed(false),
      }),
      [docId, setCollapsed, workspaceDialogService]
    )
  );

  if (isInTrash || !docRecord || isTemplate) {
    return null;
  }

  return (
    <NavigationPanelTreeNode
      icon={Icon}
      name={docTitle}
      dndData={dndData}
      onDrop={handleDrop}
      renameable
      extractEmojiAsIcon={enableEmojiIcon}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      canDrop={canDrop}
      to={`/${docId}`}
      onClick={() => {
        track.$.navigationPanel.docs.openDoc();
      }}
      active={active}
      reorderable
      renameableGuard={{
        docId,
        action: 'Doc_Update',
      }}
      onRename={handleRename}
      operations={operations}
      dropEffect={docTreeDropEffect}
      data-testid={`navigation-panel-doc-tree-${docId}`}
      explorerIconConfig={{
        where: 'doc',
        id: docId,
      }}
    >
      {children.map(child => (
        <NavigationPanelDocTreeNode
          key={child.id}
          docId={child.id}
          parentPath={path}
          onDrop={onDrop}
          canDrop={canDrop}
        />
      ))}
    </NavigationPanelTreeNode>
  );
};

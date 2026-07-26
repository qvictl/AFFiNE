import {
  IconButton,
  MenuItem,
  MenuSeparator,
  toast,
  useConfirmModal,
} from '@affine/component';
import { Guard } from '@affine/core/components/guard';
import { useBlockSuiteMetaHelper } from '@affine/core/components/hooks/affine/use-block-suite-meta-helper';
import { IsFavoriteIcon } from '@affine/core/components/pure/icons';
import { DocsService } from '@affine/core/modules/doc';
import { DocTreeService } from '@affine/core/modules/doc-tree';
import { CompatibleFavoriteItemsAdapter } from '@affine/core/modules/favorite';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import {
  DeleteIcon,
  DuplicateIcon,
  InformationIcon,
  MoveToIcon,
  OpenInNewIcon,
  PlusIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback, useMemo } from 'react';

import type { NodeOperation } from '../../tree/types';

export const useNavigationPanelDocTreeNodeOperations = (
  docId: string,
  options: {
    openInfoModal: () => void;
    openNodeCollapsed: () => void;
  }
): NodeOperation[] => {
  const t = useI18n();
  const {
    workbenchService,
    docsService,
    docTreeService,
    compatibleFavoriteItemsAdapter,
  } = useServices({
    DocsService,
    WorkbenchService,
    DocTreeService,
    CompatibleFavoriteItemsAdapter,
  });
  const { openConfirmModal } = useConfirmModal();

  const docRecord = useLiveData(docsService.list.doc$(docId));
  const node = useLiveData(
    useMemo(
      () =>
        docTreeService.docTree.nodes$.map(
          nodes => nodes.find(n => n.id === docId) ?? null
        ),
      [docTreeService, docId]
    )
  );

  const favorite = useLiveData(
    useMemo(
      () => compatibleFavoriteItemsAdapter.isFavorite$(docId, 'doc'),
      [docId, compatibleFavoriteItemsAdapter]
    )
  );

  const { duplicate } = useBlockSuiteMetaHelper();
  const handleDuplicate = useCallback(() => {
    duplicate(docId, true);
    track.$.navigationPanel.docs.createDoc();
  }, [docId, duplicate]);

  const handleOpenInfoModal = useCallback(() => {
    track.$.docInfoPanel.$.open();
    options.openInfoModal();
  }, [options]);

  const handleCreateSubpage = useCallback(() => {
    docTreeService.createDocAndOpen(docId);
    options.openNodeCollapsed();
    track.$.navigationPanel.docs.createDoc();
  }, [docTreeService, docId, options]);

  const handleMoveToRoot = useCallback(() => {
    try {
      docTreeService.moveDoc(docId, null);
    } catch (err) {
      toast((err as Error).message);
    }
  }, [docTreeService, docId]);

  const handleMoveToTrash = useCallback(() => {
    if (!docRecord) {
      return;
    }
    openConfirmModal({
      title: t['com.affine.moveToTrash.title'](),
      description: t['com.affine.moveToTrash.confirmModal.description']({
        title: docRecord.title$.value,
      }),
      confirmText: t['com.affine.moveToTrash.confirmModal.confirm'](),
      cancelText: t['com.affine.moveToTrash.confirmModal.cancel'](),
      confirmButtonOptions: {
        variant: 'error',
      },
      onConfirm() {
        // trash the whole subtree, structure is preserved for restore
        docTreeService.trashSubtree(docId);
        track.$.navigationPanel.docs.deleteDoc({
          control: 'button',
        });
        toast(t['com.affine.toastMessage.movedTrash']());
      },
    });
  }, [docRecord, docTreeService, docId, openConfirmModal, t]);

  const handleOpenInNewTab = useCallback(() => {
    workbenchService.workbench.openDoc(docId, {
      at: 'new-tab',
    });
    track.$.navigationPanel.docs.openDoc();
  }, [docId, workbenchService]);

  const handleToggleFavoriteDoc = useCallback(() => {
    compatibleFavoriteItemsAdapter.toggle(docId, 'doc');
  }, [docId, compatibleFavoriteItemsAdapter]);

  return useMemo(
    () => [
      {
        index: 0,
        inline: true,
        view: (
          <Guard docId={docId} permission="Doc_Update">
            {canEdit => (
              <IconButton
                size="16"
                icon={<PlusIcon />}
                tooltip={t[
                  'com.affine.rootAppSidebar.explorer.doc-add-tooltip'
                ]()}
                onClick={handleCreateSubpage}
                disabled={!canEdit}
              />
            )}
          </Guard>
        ),
      },
      {
        index: 1,
        view: (
          <Guard docId={docId} permission="Doc_Update">
            {canEdit => (
              <MenuItem
                prefixIcon={<PlusIcon />}
                onClick={handleCreateSubpage}
                disabled={!canEdit}
              >
                {t['com.affine.rootAppSidebar.docTree.add-subpage']()}
              </MenuItem>
            )}
          </Guard>
        ),
      },
      {
        index: 50,
        view: (
          <MenuItem
            prefixIcon={<InformationIcon />}
            onClick={handleOpenInfoModal}
          >
            {t['com.affine.page-properties.page-info.view']()}
          </MenuItem>
        ),
      },
      {
        index: 99,
        view: (
          <MenuItem prefixIcon={<DuplicateIcon />} onClick={handleDuplicate}>
            {t['com.affine.header.option.duplicate']()}
          </MenuItem>
        ),
      },
      {
        index: 99,
        view: (
          <MenuItem prefixIcon={<OpenInNewIcon />} onClick={handleOpenInNewTab}>
            {t['com.affine.workbench.tab.page-menu-open']()}
          </MenuItem>
        ),
      },
      ...(node?.parentId
        ? [
            {
              index: 100,
              view: (
                <MenuItem
                  prefixIcon={<MoveToIcon />}
                  onClick={handleMoveToRoot}
                >
                  {t['com.affine.rootAppSidebar.docTree.move-to-root']()}
                </MenuItem>
              ),
            },
          ]
        : []),
      {
        index: 199,
        view: (
          <MenuItem
            prefixIcon={<IsFavoriteIcon favorite={favorite} />}
            onClick={handleToggleFavoriteDoc}
          >
            {favorite
              ? t['com.affine.favoritePageOperation.remove']()
              : t['com.affine.favoritePageOperation.add']()}
          </MenuItem>
        ),
      },
      {
        index: 9999,
        view: <MenuSeparator key="menu-separator" />,
      },
      {
        index: 10000,
        view: (
          <Guard docId={docId} permission="Doc_Trash">
            {canMoveToTrash => (
              <MenuItem
                type={'danger'}
                prefixIcon={<DeleteIcon />}
                onClick={handleMoveToTrash}
                disabled={!canMoveToTrash}
              >
                {t['com.affine.moveToTrash.title']()}
              </MenuItem>
            )}
          </Guard>
        ),
      },
    ],
    [
      docId,
      favorite,
      handleCreateSubpage,
      handleDuplicate,
      handleMoveToRoot,
      handleMoveToTrash,
      handleOpenInNewTab,
      handleOpenInfoModal,
      handleToggleFavoriteDoc,
      node?.parentId,
      t,
    ]
  );
};

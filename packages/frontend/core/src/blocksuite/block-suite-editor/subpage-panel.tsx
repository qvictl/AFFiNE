import { Button, Divider } from '@affine/component';
import { useGuard } from '@affine/core/components/guard';
import { DocService } from '@affine/core/modules/doc';
import { DocTreeService } from '@affine/core/modules/doc-tree';
import { GlobalSessionStateService } from '@affine/core/modules/storage';
import { useI18n } from '@affine/i18n';
import { PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useServices } from '@toeverything/infra';
import { useCallback, useState } from 'react';

import { AffinePageReference } from '../../components/affine/reference-link';
import * as styles from './bi-directional-link-panel.css';

const PREFIX = 'subpage-panel-collapse:';

const useSubpagePanelCollapseState = (docId: string) => {
  const { globalSessionStateService } = useServices({
    GlobalSessionStateService,
  });

  const [open, setOpen] = useState(
    globalSessionStateService.globalSessionState.get(PREFIX + docId) ?? false
  );

  const wrappedSetOpen = useCallback(
    (open: boolean) => {
      setOpen(open);
      globalSessionStateService.globalSessionState.set(PREFIX + docId, open);
    },
    [docId, globalSessionStateService]
  );

  return [open, wrappedSetOpen] as const;
};

/**
 * Subpage list of the current doc (doc-tree), rendered next to the
 * BiDirectionalLinkPanel at the bottom of the page, collapsed by default.
 */
export const SubpagePanel = () => {
  const { docTreeService, docService } = useServices({
    DocTreeService,
    DocService,
  });
  const t = useI18n();
  const docId = docService.doc.id;
  const [show, setShow] = useSubpagePanelCollapseState(docId);
  const canEdit = useGuard('Doc_Update', docId);

  const children = useLiveData(docTreeService.docTree.childrenOf$(docId));

  const handleClickShow = useCallback(() => {
    setShow(!show);
  }, [show, setShow]);

  const handleAddSubpage = useCallback(() => {
    docTreeService.createDocAndOpen(docId);
  }, [docTreeService, docId]);

  return (
    <div className={styles.container} data-testid="subpage-panel">
      {!show && <Divider size="thinner" />}

      <div className={styles.titleLine}>
        <div className={styles.title}>{t['com.affine.docTree.subpages']()}</div>
        <Button className={styles.showButton} onClick={handleClickShow}>
          {show
            ? t['com.affine.editor.bi-directional-link-panel.hide']()
            : t['com.affine.editor.bi-directional-link-panel.show']()}
        </Button>
      </div>

      {show && (
        <>
          <Divider size="thinner" />
          <div className={styles.linksContainer}>
            <div className={styles.linksTitles}>
              {t['com.affine.docTree.subpages']()} · {children.length}
            </div>
            {children.map(child => (
              <div className={styles.link} key={child.id}>
                <AffinePageReference pageId={child.id} />
              </div>
            ))}
            {canEdit ? (
              <div
                className={styles.link}
                data-testid="subpage-add-button"
                onClick={handleAddSubpage}
                style={{ cursor: 'pointer' }}
              >
                <PlusIcon />{' '}
                {t['com.affine.rootAppSidebar.docTree.add-subpage']()}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

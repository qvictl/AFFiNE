import { Service } from '@toeverything/infra';

import type { DocsService } from '../../doc/services/docs';
import type { WorkbenchService } from '../../workbench';
import { DocTree } from '../entities/doc-tree';
import type { DocTreeStore } from '../stores/doc-tree';

export class DocTreeService extends Service {
  docTree = this.framework.createEntity(DocTree);

  constructor(
    private readonly store: DocTreeStore,
    private readonly docsService: DocsService,
    private readonly workbench: WorkbenchService
  ) {
    super();
  }

  createDoc(parentId: string | null = null) {
    if (parentId && !this.store.getNode(parentId)) {
      throw new Error('Parent doc not found');
    }
    // TEMP DEBUG: trace duplicate-creation report
    console.debug('[doc-tree] createDoc', parentId, new Error().stack);
    // go through DocsService so the BlockSuite doc gets initialized
    // (initDocFromProps, middlewares); a bare meta entry would never load
    const record = this.docsService.createDoc();
    this.store.attachDoc(record.id, parentId);
    return record.id;
  }

  createDocAndOpen(parentId: string | null = null) {
    const id = this.createDoc(parentId);
    this.workbench.workbench.openDoc(id);
    return id;
  }

  moveDoc(
    docId: string,
    newParentId: string | null,
    beforeDocId?: string | null
  ) {
    this.store.moveDoc(docId, newParentId, beforeDocId);
  }

  /** Move docId to beforeDocId's position among its siblings. */
  moveDocBefore(docId: string, beforeDocId: string) {
    const target = this.store.getNode(beforeDocId);
    if (!target) {
      return;
    }
    this.store.moveDoc(docId, target.parentId, beforeDocId);
  }

  /** Move docId to right after afterDocId among its siblings. */
  moveDocAfter(docId: string, afterDocId: string) {
    const target = this.store.getNode(afterDocId);
    if (!target) {
      return;
    }
    const siblings = this.store
      .getChildren(target.parentId)
      .filter(n => n.id !== docId);
    const pos = siblings.findIndex(n => n.id === afterDocId);
    const next = pos === -1 ? undefined : siblings[pos + 1];
    this.store.moveDoc(docId, target.parentId, next?.id ?? null);
  }

  makeChild(docId: string, parentId: string) {
    this.store.moveDoc(docId, parentId, null);
  }

  /** Trash the whole subtree; tree structure is preserved for restore. */
  trashSubtree(docId: string) {
    for (const id of this.store.collectSubtreeIds(docId)) {
      this.docsService.list.doc$(id).value?.moveToTrash();
    }
  }

  restoreSubtree(docId: string) {
    for (const id of this.store.collectSubtreeIds(docId)) {
      this.docsService.list.doc$(id).value?.restoreFromTrash();
    }
  }
}

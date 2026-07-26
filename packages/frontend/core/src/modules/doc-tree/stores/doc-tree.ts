import { Store } from '@toeverything/infra';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';

import type { WorkspaceDBService } from '../../db';
import type { DocsStore } from '../../doc/stores/docs';
import type { WorkspaceService } from '../../workspace';
import type { DocTreeNode, DocTreeSource } from '../tree-logic';
import { compareDocTreeNodes, DocTreeLogic } from '../tree-logic';

function nodesEqual(a: DocTreeNode[], b: DocTreeNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.parentId !== y.parentId ||
      x.index !== y.index ||
      x.trash !== y.trash ||
      x.createDate !== y.createDate
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Tree structure is persisted in the workspace ORM table `docTree`
 * (synced as the `db$docTree` Yjs doc — survives cache clears and new
 * profiles like organize folders do), NOT in the root doc meta.
 */
export class DocTreeStore extends Store {
  private readonly logic: DocTreeLogic;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly dbService: WorkspaceDBService,
    private readonly docsStore: DocsStore
  ) {
    super();
    const source: DocTreeSource = {
      getDocInfos: () =>
        this.workspaceService.workspace.docCollection.meta.docMetas.map(m => ({
          id: m.id,
          createDate: m.createDate ?? 0,
          trash: m.trash ?? false,
        })),
      getRecords: () => this.dbService.db.docTree.find(),
      setRecord: (id, props) => {
        const existing = this.dbService.db.docTree.get(id);
        if (existing) {
          this.dbService.db.docTree.update(id, props);
        } else {
          this.dbService.db.docTree.create({
            id,
            parentId: props.parentId ?? undefined,
            index: props.index,
          });
        }
      },
      deleteRecord: id => {
        this.dbService.db.docTree.delete(id);
      },
    };
    this.logic = new DocTreeLogic(source);
  }

  /** Structural stream of all docs (trash-inclusive), normalized. */
  watchTree() {
    // the combineLatest streams act as change triggers; the node list itself
    // is computed from consistent sync reads of the db table + doc metas
    return combineLatest([
      this.dbService.db.docTree.find$({}),
      this.docsStore.watchAllDocCreateDate(),
      this.docsStore.watchNonTrashDocIds(),
      this.docsStore.watchTrashDocIds(),
    ]).pipe(
      map(() => this.logic.getNodes()),
      distinctUntilChanged(nodesEqual)
    );
  }

  watchChildren(parentId: string | null) {
    return this.watchTree().pipe(
      map(nodes =>
        nodes.filter(n => n.parentId === parentId).sort(compareDocTreeNodes)
      ),
      distinctUntilChanged(nodesEqual)
    );
  }

  getChildren(parentId: string | null) {
    return this.logic.getChildren(parentId);
  }

  getNode(docId: string) {
    return this.logic.getNode(docId);
  }

  isAncestor(docId: string, ancestorId: string) {
    return this.logic.isAncestor(docId, ancestorId);
  }

  collectSubtreeIds(rootId: string) {
    return this.logic.collectSubtreeIds(rootId);
  }

  moveDoc(
    docId: string,
    newParentId: string | null,
    beforeDocId?: string | null
  ) {
    this.logic.moveDoc(docId, newParentId, beforeDocId);
  }

  /**
   * Attach an existing (already initialized) doc to the tree.
   * Prefer DocTreeService.createDoc, which also initializes the BlockSuite
   * doc — attaching a bare meta entry would never load.
   */
  attachDoc(docId: string, parentId: string | null) {
    this.logic.attachDoc(docId, parentId);
  }

  backfill() {
    this.logic.backfill();
  }

  watchTableLoading() {
    return this.dbService.db.docTree.isLoading$;
  }
}

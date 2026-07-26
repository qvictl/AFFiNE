import { Entity, LiveData } from '@toeverything/infra';
import { combineLatest, filter, take } from 'rxjs';

import type { DocsStore } from '../../doc/stores/docs';
import type { DocTreeStore } from '../stores/doc-tree';
import { compareDocTreeNodes, type DocTreeNode } from '../tree-logic';

function sortedChildrenOf(nodes: DocTreeNode[], parentId: string | null) {
  return nodes
    .filter(n => n.parentId === parentId && !n.trash)
    .sort(compareDocTreeNodes);
}

export class DocTree extends Entity {
  /** All docs with normalized tree structure, trash-inclusive. */
  nodes$ = LiveData.from(this.store.watchTree(), [] as DocTreeNode[]);

  /** Non-trash root-level docs in display order. */
  rootChildren$ = this.nodes$.map(nodes => sortedChildrenOf(nodes, null));

  /** Non-trash children of a doc in display order. */
  childrenOf$(parentId: string | null) {
    return this.nodes$.map(nodes => sortedChildrenOf(nodes, parentId));
  }

  /** Trash roots: trashed docs whose parent is not trashed. */
  trashRoots$ = this.nodes$.map(nodes => {
    const trashed = new Set(nodes.filter(n => n.trash).map(n => n.id));
    return nodes
      .filter(n => n.trash && (!n.parentId || !trashed.has(n.parentId)))
      .sort(compareDocTreeNodes);
  });

  isLoading$ = LiveData.from(
    combineLatest([
      this.docsStore.watchDocListReady(),
      this.store.watchTableLoading(),
    ]),
    [false, true] as [boolean, boolean]
  ).map(([synced, tableLoading]) => !synced || tableLoading);

  constructor(
    private readonly store: DocTreeStore,
    private readonly docsStore: DocsStore
  ) {
    super();
    // one-shot: backfill legacy docs once both the workspace doc list and the
    // db$docTree table are synced
    const sub = this.isLoading$
      .pipe(
        filter(loading => !loading),
        take(1)
      )
      .subscribe(() => this.store.backfill());
    this.disposables.push(() => sub.unsubscribe());
  }
}

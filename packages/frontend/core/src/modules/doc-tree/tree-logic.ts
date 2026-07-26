import { generateFractionalIndexingKeyBetween } from '@toeverything/infra';

export interface DocTreeNode {
  id: string;
  parentId: string | null;
  index: string;
  trash: boolean;
  createDate: number;
}

/** Minimal doc info the tree needs from doc metas. */
export interface DocTreeDocInfo {
  id: string;
  createDate: number;
  trash: boolean;
}

/** A row of the persisted tree structure (db$docTree). */
export interface DocTreeRecordData {
  id: string;
  parentId?: string | null;
  index?: string | null;
}

/**
 * Abstraction over tree-structure persistence so the logic can be unit-tested
 * without the DI framework / ORM / Yjs stack.
 */
export interface DocTreeSource {
  /** All docs that exist in the workspace (trash-inclusive). */
  getDocInfos(): DocTreeDocInfo[];
  /** All persisted tree rows. Rows whose doc no longer exists may appear. */
  getRecords(): DocTreeRecordData[];
  /** Upsert the tree row of a doc. */
  setRecord(
    id: string,
    props: { parentId?: string | null; index?: string }
  ): void;
  /** Remove a tree row (used to garbage-collect rows of deleted docs). */
  deleteRecord(id: string): void;
}

export function compareDocTreeNodes(a: DocTreeNode, b: DocTreeNode): number {
  // docs without an index (e.g. just created outside the tree, duplicated)
  // sort after indexed siblings, ordered by createDate
  if (!a.index && !b.index) {
    if (a.createDate !== b.createDate) return a.createDate - b.createDate;
  } else if (!a.index) {
    return 1;
  } else if (!b.index) {
    return -1;
  } else if (a.index !== b.index) {
    return a.index < b.index ? -1 : 1;
  } else if (a.createDate !== b.createDate) {
    return a.createDate - b.createDate;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Framework-free tree operations over persisted {parentId, index} records.
 * Each doc has at most one parent (strict tree, wiki-style); docs without a
 * record are root-level.
 */
export class DocTreeLogic {
  constructor(private readonly source: DocTreeSource) {}

  getNodes(): DocTreeNode[] {
    const docs = this.source.getDocInfos();
    const docIds = new Set(docs.map(d => d.id));
    const records = new Map(this.source.getRecords().map(r => [r.id, r]));
    return docs.map(doc => {
      const record = records.get(doc.id);
      const raw = record?.parentId ?? null;
      // orphan defense: a parent that is missing (deleted) or self collapses
      // to root
      const parentId =
        raw && raw !== doc.id && docIds.has(raw)
          ? raw
          : (null as string | null);
      return {
        id: doc.id,
        parentId,
        index: record?.index ?? '',
        trash: doc.trash,
        createDate: doc.createDate,
      };
    });
  }

  getNode(docId: string): DocTreeNode | null {
    return this.getNodes().find(n => n.id === docId) ?? null;
  }

  /** Children in display order. Trash-inclusive; callers filter for display. */
  getChildren(parentId: string | null): DocTreeNode[] {
    return this.getNodes()
      .filter(n => n.parentId === parentId)
      .sort(compareDocTreeNodes);
  }

  isAncestor(docId: string, ancestorId: string): boolean {
    if (docId === ancestorId) {
      return false;
    }
    const nodes = new Map(this.getNodes().map(n => [n.id, n]));
    const history = new Set<string>([docId]);
    let current = nodes.get(docId)?.parentId ?? null;
    while (current) {
      if (current === ancestorId) {
        return true;
      }
      if (history.has(current)) {
        return false; // loop detected in corrupted data
      }
      history.add(current);
      current = nodes.get(current)?.parentId ?? null;
    }
    return false;
  }

  /** All ids in the subtree including rootId itself. Trash-inclusive. */
  collectSubtreeIds(rootId: string): string[] {
    const nodes = this.getNodes();
    const byParent = new Map<string | null, string[]>();
    for (const n of nodes) {
      const list = byParent.get(n.parentId) ?? [];
      list.push(n.id);
      byParent.set(n.parentId, list);
    }
    const result: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>();
    let id: string | undefined;
    while ((id = queue.shift()) !== undefined) {
      if (seen.has(id)) {
        continue; // corrupted cycle
      }
      seen.add(id);
      result.push(id);
      queue.push(...(byParent.get(id) ?? []));
    }
    return result;
  }

  moveDoc(
    docId: string,
    newParentId: string | null,
    beforeDocId?: string | null
  ): void {
    const node = this.getNode(docId);
    if (!node) {
      throw new Error('Doc not found');
    }
    if (newParentId) {
      if (newParentId === docId) {
        throw new Error('Cannot move a doc to itself');
      }
      if (!this.getNode(newParentId)) {
        throw new Error('Parent doc not found');
      }
      if (this.isAncestor(newParentId, docId)) {
        throw new Error('Cannot move a doc to its descendant');
      }
    }
    const siblings = this.getChildren(newParentId).filter(n => n.id !== docId);
    let prev: DocTreeNode | undefined;
    let next: DocTreeNode | undefined;
    if (beforeDocId) {
      const pos = siblings.findIndex(n => n.id === beforeDocId);
      if (pos === -1) {
        throw new Error('Target sibling not found');
      }
      prev = siblings[pos - 1];
      next = siblings[pos];
    } else {
      // append after the last indexed sibling (unindexed docs sort last via
      // compareDocTreeNodes but are not valid anchors for key generation)
      prev = siblings.findLast(n => n.index);
      next = undefined;
    }
    const index = generateFractionalIndexingKeyBetween(
      prev?.index || null,
      next?.index || null
    );
    this.source.setRecord(docId, { parentId: newParentId, index });
  }

  /** Assign parentId + appended index to an existing doc (e.g. just created). */
  attachDoc(
    docId: string,
    parentId: string | null,
    beforeDocId?: string | null
  ): void {
    const node = this.getNode(docId);
    if (!node) {
      throw new Error('Doc not found');
    }
    if (parentId && !this.getNode(parentId)) {
      throw new Error('Parent doc not found');
    }
    this.moveDoc(docId, parentId, beforeDocId);
  }

  /**
   * Give every doc missing an index a fractional key appended after existing
   * siblings (ordered by createDate), normalize orphan/self parents to root,
   * and garbage-collect rows whose doc no longer exists. Idempotent.
   */
  backfill(): void {
    const nodes = this.getNodes();
    const docIds = new Set(nodes.map(n => n.id));
    for (const record of this.source.getRecords()) {
      if (!docIds.has(record.id)) {
        this.source.deleteRecord(record.id);
      }
    }
    const byParent = new Map<string | null, DocTreeNode[]>();
    for (const n of nodes) {
      const list = byParent.get(n.parentId) ?? [];
      list.push(n);
      byParent.set(n.parentId, list);
    }
    for (const group of byParent.values()) {
      let lastKey: string | null =
        group
          .filter(n => n.index)
          .map(n => n.index)
          .sort()
          .at(-1) ?? null;
      const ordered = [...group].sort(
        (a, b) => a.createDate - b.createDate || (a.id < b.id ? -1 : 1)
      );
      const rawRecords = new Map(
        this.source.getRecords().map(r => [r.id, r] as const)
      );
      for (const n of ordered) {
        const props: { parentId?: string | null; index?: string } = {};
        if (!n.index) {
          lastKey = generateFractionalIndexingKeyBetween(lastKey, null);
          props.index = lastKey;
        }
        const raw = rawRecords.get(n.id)?.parentId ?? null;
        if (raw !== n.parentId) {
          props.parentId = n.parentId;
        }
        if (props.index !== undefined || props.parentId !== undefined) {
          this.source.setRecord(n.id, props);
        }
      }
    }
  }
}

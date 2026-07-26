import { generateFractionalIndexingKeyBetween } from '@toeverything/infra';
import { describe, expect, test } from 'vitest';

import type {
  DocTreeDocInfo,
  DocTreeRecordData,
  DocTreeSource,
} from '../tree-logic';
import { DocTreeLogic } from '../tree-logic';

class MemorySource implements DocTreeSource {
  private readonly docs = new Map<string, DocTreeDocInfo>();
  private readonly records = new Map<string, DocTreeRecordData>();

  addDoc(doc: Partial<DocTreeDocInfo> & { id: string }) {
    this.docs.set(doc.id, { createDate: 0, trash: false, ...doc });
  }

  addRecord(record: DocTreeRecordData) {
    this.records.set(record.id, record);
  }

  getDocInfos(): DocTreeDocInfo[] {
    return [...this.docs.values()];
  }

  getRecords(): DocTreeRecordData[] {
    return [...this.records.values()];
  }

  setRecord(id: string, props: { parentId?: string | null; index?: string }) {
    const existing = this.records.get(id) ?? { id };
    this.records.set(id, { ...existing, ...props });
  }

  deleteRecord(id: string) {
    this.records.delete(id);
  }

  getRecord(id: string) {
    return this.records.get(id);
  }
}

type DocSpec = Partial<DocTreeDocInfo> & {
  id: string;
  parentId?: string | null;
  index?: string;
};

function setup(docs: DocSpec[]) {
  const source = new MemorySource();
  for (const { parentId, index, ...doc } of docs) {
    source.addDoc(doc);
    if (parentId !== undefined || index !== undefined) {
      source.addRecord({ id: doc.id, parentId, index });
    }
  }
  return { source, logic: new DocTreeLogic(source) };
}

describe('doc-tree logic', () => {
  test('getChildren returns sorted children of the given parent only', () => {
    const { logic } = setup([
      { id: 'a', index: 'a2', createDate: 1 },
      { id: 'b', index: 'a1', createDate: 2 },
      { id: 'c', parentId: 'a', index: 'a1', createDate: 3 },
      { id: 'd', parentId: 'a', index: 'a0', createDate: 4 },
    ]);
    expect(logic.getChildren(null).map(n => n.id)).toEqual(['b', 'a']);
    expect(logic.getChildren('a').map(n => n.id)).toEqual(['d', 'c']);
  });

  test('self parent and orphan parent normalize to root', () => {
    const { logic } = setup([
      { id: 'a', parentId: 'a', createDate: 1 },
      { id: 'b', parentId: 'missing', createDate: 2 },
    ]);
    expect(logic.getNode('a')?.parentId).toBeNull();
    expect(logic.getNode('b')?.parentId).toBeNull();
    expect(logic.getChildren(null).map(n => n.id)).toEqual(['a', 'b']);
  });

  test('moveDoc appends to the end when no beforeDocId', () => {
    const { logic } = setup([
      { id: 'a', index: 'a0', createDate: 1 },
      { id: 'b', index: 'a1', createDate: 2 },
      { id: 'c', parentId: 'p', createDate: 3 },
      { id: 'p', createDate: 4 },
    ]);
    logic.moveDoc('c', null);
    // docs without an index sort after indexed siblings; 'c' is appended last
    expect(logic.getChildren(null).map(n => n.id)).toEqual([
      'a',
      'b',
      'c',
      'p',
    ]);
    expect(logic.getNode('c')?.parentId).toBeNull();
  });

  test('moveDoc inserts before the target sibling', () => {
    const { logic } = setup([
      { id: 'a', index: 'a0', createDate: 1 },
      { id: 'b', index: 'a1', createDate: 2 },
      { id: 'c', index: 'a2', createDate: 3 },
    ]);
    logic.moveDoc('c', null, 'a');
    expect(logic.getChildren(null).map(n => n.id)).toEqual(['c', 'a', 'b']);
    logic.moveDoc('c', null, 'b');
    expect(logic.getChildren(null).map(n => n.id)).toEqual(['a', 'c', 'b']);
  });

  test('moveDoc generates strictly increasing keys on repeated appends', () => {
    const { logic, source } = setup([
      { id: 'a', createDate: 1 },
      { id: 'b', createDate: 2 },
      { id: 'c', createDate: 3 },
    ]);
    logic.backfill();
    logic.moveDoc('c', null);
    logic.moveDoc('b', null);
    const indexes = logic.getChildren(null).map(n => n.index);
    expect(indexes).toEqual([...indexes].sort());
    expect(source.getRecords().every(r => r.index)).toBe(true);
  });

  test('moveDoc rejects cycles and invalid parents', () => {
    const { logic } = setup([
      { id: 'a', index: 'a0' },
      { id: 'b', parentId: 'a', index: 'a0' },
      { id: 'c', parentId: 'b', index: 'a0' },
    ]);
    expect(() => logic.moveDoc('a', 'a')).toThrow();
    expect(() => logic.moveDoc('a', 'c')).toThrow(/descendant/);
    expect(() => logic.moveDoc('a', 'b')).toThrow(/descendant/);
    expect(() => logic.moveDoc('a', 'missing')).toThrow(/not found/);
    expect(() => logic.moveDoc('missing', null)).toThrow(/not found/);
    // valid moves still work
    logic.moveDoc('c', null);
    expect(logic.getNode('c')?.parentId).toBeNull();
  });

  test('isAncestor terminates on corrupted cycles', () => {
    const { logic } = setup([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);
    // with corrupted mutual-parent data both directions report ancestor;
    // what matters is termination and that moves get rejected
    expect(logic.isAncestor('a', 'b')).toBe(true);
    expect(logic.isAncestor('b', 'a')).toBe(true);
    expect(() => logic.moveDoc('a', 'b')).toThrow(/descendant/);
    expect(logic.collectSubtreeIds('a').sort()).toEqual(['a', 'b']);
  });

  test('attachDoc parents an existing doc at the end', () => {
    const { logic } = setup([
      { id: 'p' },
      { id: 'x', parentId: 'p', index: 'a0' },
      { id: 'y' },
    ]);
    logic.attachDoc('y', 'p');
    expect(logic.getChildren('p').map(n => n.id)).toEqual(['x', 'y']);
    expect(() => logic.attachDoc('y', 'missing')).toThrow(/not found/);
  });

  test('collectSubtreeIds covers nested trees', () => {
    const { logic } = setup([
      { id: 'a', index: 'a0' },
      { id: 'b', parentId: 'a', index: 'a0' },
      { id: 'c', parentId: 'b', index: 'a0' },
      { id: 'd', index: 'a1' },
    ]);
    expect(logic.collectSubtreeIds('a').sort()).toEqual(['a', 'b', 'c']);
    // hierarchy reads from records, independent of trash state
    expect(logic.getNode('b')?.parentId).toBe('a');
  });

  test('backfill assigns ordered keys by createDate and is idempotent', () => {
    const { logic, source } = setup([
      { id: 'new', createDate: 30 },
      { id: 'old', createDate: 10 },
      {
        id: 'mid',
        createDate: 20,
        index: generateFractionalIndexingKeyBetween(null, null),
      },
      { id: 'child', parentId: 'mid', createDate: 40 },
    ]);
    logic.backfill();
    // 'mid' already has an index; 'old' and 'new' are appended after it in
    // createDate order
    expect(logic.getChildren(null).map(n => n.id)).toEqual([
      'mid',
      'old',
      'new',
    ]);
    expect(logic.getChildren('mid').map(n => n.id)).toEqual(['child']);
    const snapshot = JSON.stringify(source.getRecords());
    logic.backfill();
    expect(JSON.stringify(source.getRecords())).toEqual(snapshot);
  });

  test('backfill normalizes orphan parents and GCs stale records', () => {
    const { logic, source } = setup([
      { id: 'orphan', parentId: 'gone', index: 'a0', createDate: 1 },
    ]);
    source.addRecord({ id: 'deleted-doc', parentId: null, index: 'a0' });
    logic.backfill();
    expect(source.getRecord('orphan')?.parentId).toBeNull();
    expect(source.getRecord('deleted-doc')).toBeUndefined();
    expect(logic.getChildren(null).map(n => n.id)).toEqual(['orphan']);
  });
});

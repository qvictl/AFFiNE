import { type Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc/services/docs';
import { DocsStore } from '../doc/stores/docs';
import { WorkbenchService } from '../workbench';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { DocTree } from './entities/doc-tree';
import { DocTreeService } from './services/doc-tree';
import { DocTreeStore } from './stores/doc-tree';

export { DocTree } from './entities/doc-tree';
export { DocTreeService } from './services/doc-tree';
export { DocTreeStore } from './stores/doc-tree';
export type { DocTreeNode } from './tree-logic';

export function configureDocTreeModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DocTreeService, [DocTreeStore, DocsService, WorkbenchService])
    .entity(DocTree, [DocTreeStore, DocsStore])
    .store(DocTreeStore, [WorkspaceService, WorkspaceDBService, DocsStore]);
}

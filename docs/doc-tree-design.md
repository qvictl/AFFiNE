# 文档树（Doc Tree）设计文档

> 本 fork 的一期功能：让 AFFiNE 文档支持树形层级结构（wiki 式），取代"只能按修改日期排序的扁平文档列表"。对齐飞书知识库的「空间 → 节点树 → 内容」模型。

## 目标与非目标

**目标**

- 每个文档最多有一个父文档（严格树），workspace 天然成为 wiki 空间
- 侧栏新增「页面」树形导航 section，支持拖拽换父、拖拽排序、新建子页面
- 父文档底部展示子页面列表（飞书式）
- 树结构随 Yjs 根文档自动同步，服务端零改动

**非目标（一期）**

- 移动端 UI
- 服务端感知树结构（GraphQL / Prisma）
- 复制文档时深复制子树
- 面包屑 / 反链中的层级展示

## 数据模型

树结构持久化在**工作区 ORM 表 `docTree`**（`packages/frontend/core/src/modules/db/schema/schema.ts`）中：

```ts
docTree: {
  id: f.string().primaryKey(),       // doc id，每文档最多一行（严格树）
  parentId: f.string().optional(),   // 缺省 = 根级
  index: f.string().optional(),      // 同级排序键（fractional indexing）
}
```

该表与 organize 文件夹、docProperties 同机制：以 `db$docTree` Yjs 文档随同步协议持久化到服务端 Postgres（snapshots/updates），换 profile、清浏览器缓存均不丢失。

设计要点：

- **结构与内容分离**（同飞书）：文档内容仍在各自的 Yjs 文档里，树只操作 `docTree` 表。
- **为什么不用根文档 meta**：初版曾把 parentId/index 放在根 Yjs 文档 `meta.pages` 里，集成测试证实该路径跨端不可靠（换 profile/清缓存后层级丢失）；`db$` 表是 AFFiNE 官方结构化数据的成熟同步路径。
- **零服务端改动**：复用现有同步管线，无需 Prisma/GraphQL 变更。
- **fractional indexing**：同级排序使用 `@toeverything/infra` 的 `generateFractionalIndexingKeyBetween`（与 organize 模块一致），移动单个节点只需更新它自己的 key。
- 回收站标记（`trash`）仍沿用 DocMeta 原有字段，不在树表里。

## 模块结构

```
packages/frontend/core/src/modules/doc-tree/
├── tree-logic.ts            # 纯逻辑（不依赖 DI/Yjs，可单测）
├── stores/doc-tree.ts       # DocTreeStore：Yjs 观察 + 薄适配
├── entities/doc-tree.ts     # DocTree：LiveData 视图 + 一次性回填
├── services/doc-tree.ts     # DocTreeService：门面 + 便捷移动方法
├── index.ts                 # configureDocTreeModule
└── __tests__/doc-tree.spec.ts
```

分层说明：

- `DocTreeLogic` 操作 `DocTreeSource` 接口（getDocInfos/getRecords/setRecord/deleteRecord），包含全部核心算法：归一化（孤儿/自引用父级 → 根级）、`getChildren`（排序）、`isAncestor`（环检测）、`moveDoc`（校验 + fractional key）、`attachDoc`、`backfill`（含失效行 GC）、`collectSubtreeIds`。
- `DocTreeStore` 把 `DocTreeLogic` 接到 `WorkspaceDBService` 的 `docTree` 表（upsert 语义）+ 根文档 meta（仅读 createDate/trash 用于排序与展示过滤）上，并提供 `watchTree()`/`watchChildren()`（db 表 + meta 流作为触发器，结构级 `distinctUntilChanged`）。
- `DocTree` 实体暴露 `rootChildren$` / `childrenOf$(parentId)` / `trashRoots$`（均排除回收站文档），并在文档列表与 `db$docTree` 表都同步完成后执行一次性幂等回填。
- `DocTreeService.createDoc` 走 `DocsService.createDoc()`（初始化 BlockSuite 文档实体）再挂到树上；`trashSubtree`/`restoreSubtree` 逐节点调用 `DocRecord.moveToTrash()`/`restoreFromTrash()`。
- 注册于 `modules/index.ts` 的 `configureDocTreeModule`，作用域 `WorkspaceScope`。

## UI 结构

```
desktop/components/navigation-panel/sections/doc-tree/
├── index.tsx       # NavigationPanelDocTree：section 容器 + drop 分发
├── node.tsx        # NavigationPanelDocTreeNode：递归树节点
├── operations.tsx  # 节点操作（新建子页面/移到根级/复制/收藏/删除子树）
└── dnd.ts          # dropEffect / canDrop
```

- 复用通用树组件 `navigation-panel/tree/`（折叠、重命名、右键菜单、拖拽指示线）。
- 挂载在 `root-app-sidebar` 的最顶部（Favorites 之上）。
- 拖拽语义：`reorder-above/below` → 同级排序；`make-child`/`reparent` → 换父。环检测失败时 toast 报错。
- 模板文档（`docProperties.isTemplate`）和回收站文档在树中不显示。
- 文档底部的「子页面」面板（`blocksuite/block-suite-editor/subpage-panel.tsx`）与 Bi-Directional Links 面板并列，同一 show/hide 交互（默认折叠，折叠状态按文档持久化在 GlobalSessionState），展开后显示子页面引用列表 + 新建子页面入口。

## 语义决策

| 场景                 | 行为                                                        |
| -------------------- | ----------------------------------------------------------- |
| 删除父文档           | 整棵子树标记 `trash: true`（`trashSubtree`），parentId 保留 |
| 从回收站恢复         | 整棵子树恢复（`restoreSubtree`），层级原样还原              |
| 回收站展示           | 只显示子树根（`trashRoots$`：父未回收的回收文档）           |
| 移动                 | 禁止移到自身/后代下；fractional key 只需更新被移动节点      |
| 复制文档             | 平级副本（沿用现有 duplicate 行为），不深复制子树           |
| 导入文档             | 落到根级（回填逻辑兜底）                                    |
| 孤儿（父被永久删除） | 读取时归一化为根级，回填时写回                              |
| 存量文档             | 首次同步后按 createDate 顺序分配根级排序键，幂等            |

## 与 organize（文件夹）模块的关系

两者独立共存：organize 是「链接式收藏夹」（一个文档可出现在多个文件夹），文档树是「归属式层级」（一个文档一个父）。一期不合并；二期可考虑用文档树取代 organize。

## 二期候选

- 移动端树导航
- 面包屑导航（文档头部显示祖先路径）
- 复制/移动子树的批量操作
- 服务端感知树结构（搜索索引、权限继承）
- 子页面列表改为 BlockSuite block（内容内嵌，可随文档导出）

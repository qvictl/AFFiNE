# 文档树功能 Runbook（开发 / 测试 / 发布）

本文档覆盖本 fork 的完整工作流：本地开发、单元测试、集成测试、镜像构建、发布到自建 registry、服务器部署。

## 0. 环境要求

- Node 22（`.nvmrc` 指定 22.23.1；>=22.12 <23 即可）：`nvm use 22`
- Yarn 4.13（corepack 自动管理）：`corepack enable`
- Rust（`rust-toolchain.toml` 自动拉取指定版本，需要 rustup）
- Docker + docker compose（daemon 需运行：`sudo systemctl start docker`）

首次安装依赖：

```sh
yarn install
```

## 1. 单元测试

```sh
# 只跑文档树
yarn vitest run packages/frontend/core/src/modules/doc-tree

# 全量（frontend/common；electron 用例需要构建 @affine/native，未构建时会失败，属环境问题）
yarn test

# 后端（本功能无后端改动，用于回归确认）
yarn workspace @affine/server test
```

类型检查：`yarn typecheck`

## 2. 本地集成测试环境

一键拉起依赖（postgres+pgvector / redis / mailpit / manticore）+ 构建 server-native + 初始化数据库：

```sh
scripts/run-integration-env.sh          # 完整初始化
scripts/run-integration-env.sh --deps   # 只起 docker 依赖
scripts/run-integration-env.sh --down   # 停止依赖
```

已知问题：`yarn affine server init` 在非交互终端会 hang（prisma update check），脚本内已改为分步执行 `prisma migrate dev --skip-generate` + `prisma generate` + `data-migration run`（均带 `CI=1`）。

然后开两个终端：

```sh
yarn affine server dev     # 后端 http://localhost:3010
yarn dev                   # 前端 web
```

内置测试账号：`dev@affine.pro / dev`、`pro@affine.pro / pro`、`team@affine.pro / team`。

### 集成测试清单（文档树）

- [ ] 侧栏顶部出现「页面」树 section，存量文档回填为根级节点
- [ ] 「+」新建根文档；节点上「+」/菜单新建子页面并自动展开
- [ ] 拖拽排序（reorder-above/below）；拖拽到节点上换父（make-child）
- [ ] 把父文档拖到自己后代下 → 拒绝并 toast
- [ ] 删除父文档 → 整棵子树进回收站；恢复 → 层级原样还原
- [ ] 父文档底部出现子页面列表，可点击跳转、可新建子页面
- [ ] 折叠状态刷新后保留
- [ ] 开两个浏览器 profile 登录同一 workspace，A 端建树，B 端实时同步
- [ ] 永久删除父文档后其子文档成为根级（孤儿归一化）
- [ ] 收藏/搜索/All Docs 平铺页行为不变

## 3. 构建并发布镜像

```sh
# 本地构建（单架构 linux/amd64，tag 默认 doc-tree-<short-sha>）
scripts/build-local-image.sh

# 构建并推送到自建 registry
REGISTRY=registry.example.com/affine PUSH=1 scripts/build-local-image.sh

# 自定义 tag / 平台
REGISTRY=registry.example.com/affine TAG=v0.27.0-doc-tree.1 PLATFORM=linux/amd64 PUSH=1 \
  scripts/build-local-image.sh
```

说明：

- 脚本复刻 `.github/workflows/build-images.yml`：web/admin/mobile dist → server-native（Rust）→ server dist → 生产依赖裁剪 → `docker build -f .github/deployment/node/Dockerfile`。
- **注意**：生产裁剪步骤会改动本地 `node_modules`，脚本结束（含失败）会自动 `yarn install` 恢复。
- 已有 dist 可用 `SKIP_WEB=1 SKIP_ADMIN=1 SKIP_MOBILE=1 SKIP_SERVER=1` 跳过重建。

## 4. 服务器部署（self-host）

服务器上准备 `.docker/selfhost/compose.yml` 的副本（见仓库 `.docker/selfhost/`），把 image 改成自建镜像：

```yaml
services:
  affine:
    image: registry.example.com/affine:v0.27.0-doc-tree.1
  affine_migration:
    image: registry.example.com/affine:v0.27.0-doc-tree.1
```

并按 `.docker/selfhost/config.example.json` 准备配置后：

```sh
docker compose up -d
```

数据（postgres 卷、上传目录）与官方镜像完全兼容，可随时切回官方 tag。

## 5. 目录速查

| 内容                       | 位置                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| 功能设计文档               | `docs/doc-tree-design.md`                                                           |
| 核心逻辑（纯函数，可单测） | `packages/frontend/core/src/modules/doc-tree/tree-logic.ts`                         |
| 侧栏树 UI                  | `packages/frontend/core/src/desktop/components/navigation-panel/sections/doc-tree/` |
| 子页面面板                 | `packages/frontend/core/src/blocksuite/block-suite-editor/subpage-panel.tsx`        |
| 集成环境脚本               | `scripts/run-integration-env.sh`                                                    |
| 镜像构建脚本               | `scripts/build-local-image.sh`                                                      |

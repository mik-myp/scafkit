# Contributing to scafkit

感谢你为 `scafkit` 做贡献。

本项目是一个本地优先的 CLI 脚手架，核心能力包括模板管理、项目初始化、AI 审查与自动提交信息生成。

## 1. 开发环境

- Node.js >= 20
- pnpm >= 10
- Git

初始化项目：

```bash
pnpm install
```

## 2. 本地开发命令

```bash
pnpm run dev -- --help
pnpm run lint
pnpm run test
pnpm run build
pnpm run release:check
```

提交前至少确保：

1. `pnpm run lint` 通过
2. `pnpm run test` 通过
3. `pnpm run build` 通过

## 3. 分支与提交规范

建议分支命名：

- `feat/<short-name>`
- `fix/<short-name>`
- `docs/<short-name>`
- `refactor/<short-name>`

提交信息遵循 Conventional Commits，允许中文主题：

- `feat(cli): 支持模板变量默认值`
- `fix(hook): 修复 commit-msg 在空 diff 下异常`

## 4. 代码改动建议

### 4.1 新增命令

优先在以下结构中扩展：

- `src/commands/*`：CLI 参数与命令入口
- `src/core/*`：业务逻辑
- `src/db/*`：数据模型、迁移、存储

### 4.2 变更数据结构

如果修改 `db.json` 结构，请同步更新：

- `src/types.ts`
- `src/db/schemas.ts`
- `src/db/migrations.ts`

并补充测试覆盖旧数据迁移路径。

### 4.3 测试要求

- 单元测试放在 `tests/unit/`
- 集成测试放在 `tests/integration/`
- 新功能至少补一个成功路径测试和一个失败/边界路径测试

## 5. 提交 PR 前检查清单

1. 我已阅读并遵守本文档。
2. 代码通过 `lint/test/build`。
3. 我更新了相关文档（如 README、RELEASE、CHANGELOG）。
4. 如果有行为变化，我补充了测试。
5. 提交信息符合 Conventional Commits。

## 6. 发布相关

发布流程见：`RELEASE.md`

版本变更记录见：`CHANGELOG.md`

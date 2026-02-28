# scafkit

本地优先的脚手架 CLI，支持模板管理、项目初始化、AI 代码审查与自动生成中文提交信息。

## 1. 你可以用 scafkit 做什么

- 使用本地 JSON 文件当数据库，不依赖远端服务。
- 管理模板（远程 Git 仓库）：新增、查看、更新、删除、同步。
- 从模板快速初始化新项目，支持变量渲染。
- 让 AI 审查 `git staged diff`，输出风险项和测试建议。
- 生成中文 Conventional Commit 提交信息，并在确认后自动执行 `git commit` / `git push`。
- 安装 `commit-msg` hook，让提交时自动写入提交信息。
- AI 失败时默认不阻塞提交流程。

## 2. 环境要求

- Node.js `>= 20`
- pnpm `>= 10`（开发模式推荐）
- Git（使用 `git review` / `git commit-message` / `hook` 时必须）

## 3. 安装方式

### 3.1 开发模式（当前仓库）

```bash
pnpm install
pnpm build
pnpm dev -- --help
```

### 3.2 全局命令模式（推荐日常使用）

在发布到 npm 后：

```bash
npm install -g scafkit
scafkit --help
```

## 4. 三分钟快速上手

### 4.1 配置 AI

```bash
scafkit ai set --api-key sk-xxxx --base-url https://api.openai.com/v1 --model gpt-4o-mini --timeout 30000
```

### 4.2 添加远程模板

```bash
scafkit template add --name node-lib --source github.com/org/template-repo
scafkit template add --name node-lib --source git@gitlab.com:group/template-repo
scafkit template add --name node-lib --source gitee.com/group/template-repo
scafkit template add --name node-lib --source group/template-repo
```

### 4.3 查看模板 ID

```bash
scafkit template list
```

### 4.4 生成项目

```bash
scafkit init my-project --template tpl_xxxxx --var owner=kirito
```

### 4.5 审查暂存区代码并生成提交信息（可自动提交推送）

```bash
git add .
scafkit git review
scafkit git commit-message
```

### 4.6 安装自动提交 Hook

```bash
scafkit hook install
```

## 5. 数据存储说明（本地文件数据库）

scafkit 默认把所有数据放在用户目录下：

- `~/.scafkit/db.json`：数据库文件（模板 + AI 配置）
- `~/.scafkit/templates/`：Git 模板缓存目录

你也可以用环境变量切换数据根目录（适合测试/隔离环境）：

```bash
export SCAFKIT_HOME=/tmp/my-scafkit-home
```

### 5.1 `db.json` 结构示例

```json
{
  "version": 2,
  "templates": [
    {
      "id": "tpl_xxxxx",
      "name": "node-lib",
      "source": "https://github.com/org/template-repo.git",
      "branch": "main",
      "subPath": "templates/base",
      "variables": [
        { "key": "owner", "required": true, "desc": "负责人" },
        { "key": "license", "required": false, "defaultValue": "MIT" }
      ],
      "createdAt": "2026-02-28T00:00:00.000Z",
      "updatedAt": "2026-02-28T00:00:00.000Z"
    }
  ],
  "ai": {
    "activeProfileId": "ai_xxxxx",
    "profiles": [
      {
        "id": "ai_xxxxx",
        "name": "default",
        "baseURL": "https://api.openai.com/v1",
        "apiKey": "sk-xxxx",
        "model": "gpt-4o-mini",
        "timeoutMs": 30000,
        "createdAt": "2026-02-28T00:00:00.000Z",
        "updatedAt": "2026-02-28T00:00:00.000Z"
      }
    ]
  }
}
```

## 6. 模板规范

### 6.1 支持来源

- `git`：远程 Git 仓库（会拉取到 `~/.scafkit/templates/<templateId>`），支持 GitHub/GitLab/Gitee，不区分 HTTPS/SSH 输入形式

### 6.2 变量定义

`template add/update` 可通过 `--variables` 传 JSON 数组：

```json
[
  { "key": "owner", "required": true, "desc": "项目负责人" },
  { "key": "license", "required": false, "defaultValue": "MIT" }
]
```

变量值优先级：

1. `scafkit init --var key=value`
2. `variables` 里的 `defaultValue`
3. 运行时交互输入

### 6.3 渲染规则

- 文本文件会按 EJS 语法渲染（可使用 `<%= projectName %>` 等变量）。
- 文件名以 `.ejs` 结尾时，生成后会去掉 `.ejs` 后缀。
- 常见二进制文件（图片/字体/压缩包等）不会进行文本渲染，直接复制。

## 7. 命令大全

### 7.1 `template` 模板管理

### 新增模板

```bash
scafkit template add [--id <id>] [--name <name>] [--description <desc>] [--source <git-url|host/repo|group/repo>] [--branch <branch>] [--sub-path <subPath>] [--variables '<json-array>']
```

示例（Git 模板）：

```bash
scafkit template add --name react-admin --source github.com/org/template-repo --branch main --sub-path templates/admin
scafkit template add --name react-admin --source git@gitlab.com:group/subgroup/template-repo --branch main --sub-path templates/admin
scafkit template add --name react-admin --source gitee.com/group/template-repo --branch main --sub-path templates/admin
```

### 列表 / 详情 / 更新 / 删除 / 同步

```bash
scafkit template list
scafkit template show <id>
scafkit template update <id> [--name <name>] [--source <git-url|host/repo|group/repo>] [--branch <branch>] [--sub-path <subPath>] [--variables '<json-array>']
scafkit template remove <id> [-y]
scafkit template sync <id>
```

### 7.2 `init` 初始化项目

```bash
scafkit init <projectName> -t <templateId> [--dest <path>] [-f] [--var key=value ...]
scafkit init-interactive [--dest <path>] [-f] [--var key=value ...]
```

示例：

```bash
scafkit init awesome-app -t tpl_xxxxx --dest ./workspace --var owner=kirito --var license=MIT
scafkit init-interactive
```

说明：

- `init-interactive` 会先展示已配置模板列表，可通过上下方向键选择模板并回车确认。
- 选择模板后会继续提示输入项目名称、目标目录、是否强制覆盖等配置。

### 7.3 `ai` AI 配置

```bash
scafkit ai set [--name <profile>] [--api-key <key>] [--base-url <url>] [--model <model>] [--timeout <ms>]
scafkit ai list
scafkit ai use <id|name>
scafkit ai show
scafkit ai test
```

说明：

- `ai set` 会新增或更新指定 profile，并自动切换为当前 profile。
- `ai list` 查看所有 profile，`active=*` 表示当前生效配置。
- `ai use` 可在 profile 间切换。
- `ai show` 会脱敏显示当前 profile 的 `apiKey`。
- 未传 `--api-key` 时会进入安全输入模式。

### 7.4 `git` AI Git 助手

```bash
scafkit git review
scafkit git commit-message
```

说明：

- 两个命令都基于 `staged diff`（即 `git add` 后的内容）。
- `git commit-message` 会先展示 AI 生成内容，再二次确认是否直接提交推送。
- 若不使用 AI 生成内容，会提示手动输入提交信息，然后执行 `git commit` / `git push`。
- 无暂存变更时会提示并退出。

### 7.5 `hook` 提交钩子

```bash
scafkit hook install
scafkit hook status
scafkit hook uninstall
```

说明：

- `hook install` / `hook status` / `hook uninstall` 需要在目标 Git 仓库目录中执行。

内部命令（通常无需手动调用）：

```bash
scafkit hook run-commit-msg <messageFile>
```

## 8. 典型工作流

### 8.1 日常开发流程

```bash
# 1) 先准备一次模板
scafkit template add --name web-ts --source github.com/org/template-repo

# 2) 基于模板初始化项目
scafkit init demo-web --template tpl_xxxxx --var owner=kirito

# 3) 开发并暂存代码
git add .

# 4) 先看审查建议
scafkit git review

# 5) 生成提交信息并按交互执行 commit/push
scafkit git commit-message

# 6) （可选）如果偏好原生 git commit，可安装一次 hook（仓库级）
scafkit hook install
```

### 8.2 Git 模板更新流程

```bash
scafkit template sync <templateId>
scafkit init another-project --template <templateId>
```

说明：

- 使用 GitHub/GitLab/Gitee 的远程模板时，`sync` 后可直接 `init` 生成项目。

## 9. 常见问题与排查

- `当前目录不是 Git 仓库`
  - 在仓库根目录执行，或先 `git init`。
- `没有 staged 变更`
  - 先执行 `git add <files>` 再运行 `scafkit git review` / `scafkit git commit-message`。
- `AI 配置不存在`
  - 先执行 `scafkit ai set`。
- `目标目录非空`
  - 改目录名，或使用 `scafkit init ... --force`。
- `hook install 后提交没有自动生成信息`
  - 先 `scafkit hook status` 检查是否安装成功。
  - 确保终端可找到 `scafkit` 命令（`which scafkit`）。
- AI 超时/限流
  - 当前策略为不阻塞提交，手动编辑 commit message 即可继续。

## 10. 安全说明

- `apiKey` 当前为本地明文存储在 `~/.scafkit/db.json`。
- 建议仅在个人可信开发机使用，并控制目录权限。

## 11. 开发者调试

```bash
pnpm install
pnpm build
pnpm test
pnpm dev -- --help
```

## 12. 发布相关文档

- 发布步骤与回滚策略：`RELEASE.md`
- 版本变更记录：`CHANGELOG.md`

## 13. 参与贡献

- 贡献规范：`CONTRIBUTING.md`
- PR 模板：`.github/pull_request_template.md`
- Issue 模板：`.github/ISSUE_TEMPLATE/`



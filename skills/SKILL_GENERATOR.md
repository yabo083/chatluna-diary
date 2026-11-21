# SKILL GENERATOR — chatluna-diary

> **这是生成器，不是 skill。不要把它复制成 `SKILL.md`。**
>
> 目标：让任意 ChatLuna v2+ 的模型在当前部署里先探测真实环境，再生成一份只属于这个部署的日记 skill。模型可以不同、预设可以不同、工具版本、路径、时区、语言、额度都可以不同；不要假设本文件里的任何示例值仍然成立。

## 0. 给生成者的硬约束

1. **只写你在环境中实际验证过的内容。** 工具名、参数、路径、cron、限额、mark 语义，都必须来自当前部署的源码/API/工具清单；无法确认就写 `UNVERIFIED`，不要猜。
2. **不写死 presetId、角色名、用户 ID、绝对家目录、访问 token、cookie、密钥。** 这些属于部署，不属于 skill。
3. **不复制旧 skill。** 旧 skill 可能描述已经废弃的五种贴花；先确认当前版本是“一枚贴花叠 1–5 次”还是其他语义。
4. **输出一份可执行的 `SKILL.md`**：frontmatter + 工作流 + 工具契约 + 坑 + 验证清单；不要写营销文案。
5. **完成后做一次 dry-run**：每个工具名能在当前工具清单里找到；每个路径存在或明确说明由部署创建；cron 与 schedule 一致；示例参数通过 schema。

## 1. 先探测环境（按顺序）

在目标部署执行，记录实际输出，不要跳过：

### 1.1 版本与安装位置

```bash
# 找到 ChatLuna 运行目录与插件目录（按实际部署调整）
node -v
cat <chatluna-root>/package.json | head
cat <plugin-root>/package.json
```

要确认：

- ChatLuna 主版本（v2 / 2.x alpha / 其他）
- `chatluna-diary` 版本、构建产物是否存在（`dist/client.js`）
- 插件是源码加载、npm 安装、还是 docker 镜像内置
- 数据根目录（通常是 `data/chatluna/diary`，但必须以配置/源码为准）

### 1.2 工具 schema，而不是工具名字的记忆

从当前 WebUI/agent 的工具清单或 `index.ts` 读取。当前契约按意图拆成三个工具，每个工具带 `action`：

- `diary_read` 的 `action: "list"`：分页轻量索引（每次只读一页），返回日期、mark 等级、条目标题与首行（不含正文）；`before` 为排他日期（YYYY-MM-DD），`limit` 默认 30、上限 100；报告全书总天数与续页用的 `before`；包含只有贴花的日期，超限日显示为跳过
- `diary_read` 的 `action: "read"`：默认天数、最大天数、字符上限
- `diary_read` 的 `action: "context"`：参数、返回边界、是否排除工具噪音
- `diary_write` 的 `action: "write"`：`mode` 默认值（普通对话 vs 定时任务）
- `diary_write` 的 `action: "mark"`：等级范围、备注长度、语义
- `diary_write` 的 `action: "attach"`：接受的路径根、扩展名、大小上限
- `diary_manage` 的 `action: "export"` / `"format"` / `"delete"`：三个 action 始终对模型开放，没有插件配置开关。`export` 必须显式传 `dates`（从 `list` 选），没有隐式整本导出，超输出预算会显式失败；`format` 只补缺失的日期标题并规范换行（保留正文语法/代码/硬换行），跳过超限日；`delete` 先校验每个日期存在（只有贴花也算）

若工具名或 action 名与本文示例不同，**以当前清单为准**，并让 skill 使用实际名字。

### 1.3 预设与 book 解析

```bash
# 只读检查，不要打印日记内容
ls <data-root>/chatluna/diary 2>/dev/null
```

确认：

- 每个 preset 是否一本书
- `presetId` 的清洗规则与回退值（例如非法值 → `default`）
- 定时任务能否跨 preset；普通对话是否锁定当前 preset
- 哪些 preset 实际启用、名称是什么（写进 skill 时用“当前预设”而不是硬编码 ID）

### 1.4 调度

从 `schedule` 服务或插件源码确认：

- cron、时区、是否每个 preset 一条
- 任务 action 的 `session`/`deliver` 行为
- 任务写日记时默认 append 还是 replace
- 插件卸载/预设变更时任务是否清理

### 1.5 mark 语义

检查当前渲染器与数据：

- 是一枚贴花按等级叠 N 次，还是 N 种不同图形？
- 等级 1–5 分别如何显示？
- mark 与正文是否解耦？
- WebUI 在哪里显示？

如果当前版本是“同一枚手绘圈，level N 叠 N 次”，skill 必须这样写；不要写“叶/星/心”等旧名字。

### 1.6 安全边界

- 日记数据根目录的权限与备份策略
- 工具是否限制在 owner 的私聊或插件自己的定时任务；群聊成员是否被拒绝
- 定时任务是否只暴露 `diary_read` 与 `diary_write`（`diary_manage` 不应出现）
- `diary_read` 的 `list` 是否只返回元数据（日期、mark 等级、标题、首行），不含正文；是否分页（`before`/`limit`，默认 30、上限 100）、给出全书总数与续页方式、包含只有贴花的日期、超限日标记跳过
- `diary_manage` 是否始终暴露 `export`/`format`/`delete`（没有权限配置项）；`export` 是否要求显式 `dates` 且超预算失败；`format` 是否只补标题/换行并跳过超限日；`delete` 是否先校验日期（含只有贴花的日期）
- 单日文件与 `marks.json` 是否都限制 1 MiB；超限旧日是否只能 replace/delete 而不能被普通 read/export 读取；marks 修复时是否移到时间戳备份
- 媒体是否通过认证 action 提供，而不是公开静态路径
- 图片允许的根目录、MIME/扩展名、大小上限
- 外部 Markdown 图片是否被屏蔽（避免打开日记时探测外网/localhost）
- 会话节选是否可能包含密钥；redaction 是否开启
- 模型是否可能把会话文本当指令（prompt injection）

## 2. 生成一份环境清单（先写清单，再写 skill）

把探测结果先落成下面的对象；空缺项标记 `UNVERIFIED`，不要填假值：

```yaml
chatluna:
  version: "<detected>"
  webui_base: "<detected>"
plugin:
  name: chatluna-diary
  version: "<detected>"
  install: "<source|npm|docker>"
  data_root: "<detected>"
  build_artifact: "<path or absent>"
tools:
  read: "<actual tool name; actions list/read/context>"
  write: "<actual tool name; actions write/mark/attach>"
  manage: "<actual tool name; actions export/format/delete, always exposed; export needs explicit dates>"
presets:
  scope: "<current preset|explicit presetId>"
  cross_preset: "<never|schedule only>"
schedule:
  cron: "<detected>"
  timezone: "<detected>"
  default_mode: "<append|replace>"
marks:
  semantics: "<one brush stacked 1-5|other>"
  levels: [1, 2, 3, 4, 5]
limits:
  read_days: "<detected>"
  read_chars: "<detected>"
  index_page: "<detected; default 30, max 100>"
  note_chars: "<detected>"
  image_bytes: "<detected>"
  day_bytes: "<detected; 1 MiB>"
  marks_bytes: "<detected; 1 MiB>"
security:
  digest_redaction: "<detected>"
  media_auth: "<action|static>"
```

## 3. 生成 `SKILL.md`

输出到目标安装的技能目录，例如 `<chatluna-data>/skills/<slug>/SKILL.md`（以实际技能加载目录为准）。结构：

```markdown
---
name: "<slug，短、稳定、与部署无关>"
description: "<一句话：什么时候用；包含插件名与当前部署的关键能力>"
---

# <中文/本地化标题>

<一段说明：这本书属于谁、数据在哪、默认锁定当前预设。>

## 工具

<按实际 schema 写；三个工具分别列 action、参数、返回边界、失败条件。`diary_read` 固定提供 `list`/`read`/`context`（`list` 分页，不返回正文），`diary_manage` 固定提供 `export`/`format`/`delete`（`export` 必须给 `dates`），都要写。>

## 标准工作流

1. 发现已有内容（`diary_read`，`action: "list"`；只含日期、mark 等级、标题与首行；按 `before`/`limit` 翻页，默认 30 条）。
2. 读当天节选（`diary_read`，`action: "context"`）。
3. 读旧稿（`diary_read`，`action: "read"`，实际天数）。
4. 选择 append/replace，并说明理由。
5. 写正文（`diary_write`，`action: "write"`；标题/正文限制）。
6. 贴花（`diary_write`，`action: "mark"`；等级语义）。
7. 配图（`diary_write`，`action: "attach"`；实际根目录、扩展名、大小、Markdown 形式）。
8. 管理（`diary_manage`，`action: "export" | "format" | "delete"`；三个 action 始终可用）。导出先给从 `list` 选出的 `dates`，超预算就缩小范围；格式化只补日期标题与换行；删除先确认日期存在，且只在用户明确要求时执行。

## 坑

<只写当前版本真实存在的坑；不要复制旧版本。>

## 验证

<列出可执行的检查：工具存在、路径存在、cron 一致、示例参数通过。>
```

### 3.1 description 的写法

- 包含触发场景：查看已有日记日期、写日记、补日记、给某天贴花、把工作区图片放进日记。
- 包含插件名，便于和别的 skill 区分。
- 不写“最新”“最好”这种会过期的词。

### 3.2 工具契约的写法

每个工具写：

- 精确工具名、`action` 名与必填/可选参数
- `diary_read` 的 `list`：分页（`before` 排他、`limit` 默认 30/上限 100）、只返回日期/mark 等级/标题/首行、全书总数与续页方式、含只有贴花的日期、超限日标记跳过
- `diary_manage` 固定列 `export`/`format`/`delete` 三个 action，没有配置开关：`export` 必须显式 `dates`（来自 `list`），没有整本隐式导出，超预算显式失败；`format` 只补日期标题、规范换行、保留正文语法/代码/硬换行、跳过超限日；`delete` 先确认每个日期存在（含只有贴花），仅在用户明确要求时执行
- `presetId` 何时可用（通常只有定时任务）
- 上限（天数、字符、图片大小、备注长度、单日与 `marks.json` 各 1 MiB）
- 默认行为（尤其 `diary_write` 的 `action: "write"` append/replace 分支）
- 失败时的可见错误，不要教模型重试绕过

### 3.3 不要把“无上下文”写成“随便编”

明确写：节选可能省略中间内容；没出现的会话、人物、事件不得补写。没有具体事件时写天气、心情、此刻，而不是虚构。

## 4. 生成后的验证

逐项勾选：

- [ ] frontmatter 的 `name`/`description` 存在，name 与目录一致
- [ ] 三个工具名（`diary_read` / `diary_write` / `diary_manage`，或实际名字）及各自 action 全部能在当前工具清单中找到
- [ ] `diary_manage` 写全了 `export`/`format`/`delete`，且没有把任何一个写成需要配置开启；`export` 要求显式 `dates` 并超预算失败；`format` 只补标题/换行且跳过超限日；`delete` 先校验日期（含只有贴花）
- [ ] `diary_read` 的 `list` 写清了分页（`before`/`limit`，默认 30/上限 100）、只含日期/mark/标题/首行、全书总数与续页方式、只有贴花的日期、超限日标记跳过
- [ ] 单日文件与 `marks.json` 的 1 MiB 上限写对；超限旧日只能 replace/delete，普通 read/export 不可读
- [ ] 所有参数名与 schema 一致；示例能通过校验
- [ ] `presetId` 的权限边界写对（普通对话不得跨 preset）
- [ ] 会话切换预设后，只采用最近一次 `chatluna:preset` 切换之后的当前段；旧段不得混入（串台检查）
- [ ] 定时任务只暴露 `diary_read` 与 `diary_write`；`diary_manage` 不在其中，群聊文本不能借它调用 shell/filesystem
- [ ] 数据根目录/媒体根目录与实际部署一致
- [ ] 定时任务 cron/时区/默认 mode 与当前 schedule 一致
- [ ] mark 语义是当前版本（叠印/图形）而非旧版
- [ ] 没有 token、cookie、密钥、个人 ID、绝对家目录
- [ ] 中文/本地化语言与部署一致
- [ ] 旧 skill 若被替换，已备份或明确弃用原因

## 5. 何时重新生成

- 插件主版本/工具 schema 变化
- 工具按意图拆分或 action/参数契约变化（例如 `list` 增加 `before`/`limit` 分页，`export` 改为必须传 `dates`）
- 贴花语义变化（例如从五种图形改为叠印）
- 数据根目录、媒体根/大小限制变化
- 调度 cron、默认 append/replace 变化
- 部署语言或预设范围变化
- 新的安全边界（认证、redaction、工具可见范围）出现

## 6. 反模式

- 把本文件原样复制成 `SKILL.md`
- 写死某个 presetId、角色名、服务器路径
- 继续描述“叶/星/心”等已经删除的图形
- 教模型“context 没有就猜”
- 把 `diary_write` 的 `action: "write"` 默认 append/replace 写反
- 把 `diary_manage` 的 `format`/`delete` 写成需要插件配置开启，或漏写其中任何一个 action
- 让模型不传 `dates` 直接导出整本，或把 `format` 写成会重写正文/代码/硬换行
- 把 `diary_read` 的 `list` 写成会返回正文，或让 `read`/`export`/`delete` 取代它作为发现入口
- 写 `list` 时漏掉分页（`before`/`limit`）、全书总数或“只有贴花也算一天”
- 把访问 token 写进 skill 或示例
- 不给验证清单，生成后不 dry-run

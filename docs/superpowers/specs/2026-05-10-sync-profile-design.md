# sync-profile：可复制的开发者知识系统

> 一个 Skill + 目录结构，把你的个人侧写、配置、踩坑记录打包成可跨环境复制的种子包。
>
> 配套可视化工作流图：[dev-profile-workflow.html](./dev-profile-workflow.html)

## 目标

- **跨环境复制**：家里/公司/新项目，U盘一插 AI 就认识你
- **知识分层**：通用经验所有项目带，语言特有按语言过滤，版本特有按版本过滤
- **零依赖**：纯 Markdown + PowerShell（Win10 自带），不用装任何东西
- **持续维护**：项目新教训回收回种子包，种子包更新推送到已有项目

## 目录结构

```
.claude/skills/sync-profile/
├── SKILL.md                       ← AI 读这个按步骤执行
├── seed.yaml                      ← 版本号 + changelog
│
├── profile/                       ← 你这个人（跨环境通用）
│   ├── personal.md                ← 技术栈、经验年限、项目经历
│   ├── coding.md                  ← 编码规范（命名、风格、禁止项）
│   └── workflow.md                ← AI 协作规则（先确认、先测量、一次一变量）
│
├── config/                        ← 全局配置模板
│   ├── global-settings.json       ← ~/.claude/settings.json 模板
│   └── permissions.md             ← 权限配置设计原则
│
├── knowledge/                     ← 踩坑记录（按语言/版本分层）
│   ├── common/                    ← 所有项目都带
│   │   └── debugging.md           ← 调试方法论
│   ├── rust/                      ← 仅 Rust 项目
│   │   └── tauri-pitfalls.md
│   └── java/                      ← 仅 Java 项目
│       ├── common.md
│       └── spring-boot/
│           ├── 1.5.md
│           └── 3.0.md
│
└── scaffolds/                     ← 项目骨架模板（按项目类型选取）
    ├── rust-tauri/
    │   ├── CLAUDE.md.hbs
    │   ├── LESSONS.md.hbs
    │   ├── ARCHITECTURE.md.hbs
    │   ├── design-system.md.hbs
    │   └── settings.local.json.hbs
    └── generic/
        └── CLAUDE.md.hbs
```

## 三个操作

### init — 新项目初始化

_触发：`/sync-profile init`_

1. AI 问：种子包路径（默认去找 `.claude/skills/sync-profile/` 自身）
2. AI 问：项目语言类型（rust / java / node / other）
3. AI 问：框架/版本（如 spring-boot-1.5）
4. 根据语言和版本复制对应 `knowledge/` 子集到项目的 `docs/LESSONS.md`
5. 从 `scaffolds/` 选对应模板，生成项目 `CLAUDE.md` + `docs/` 骨架
6. 把 `config/global-settings.json` 的 `permissions.allow`/`deny` 数组合并到 `~/.claude/settings.json`（追加不覆盖），其他字段以种子包优先
7. 生成 `.claude/settings.local.json`

### pull — 回收项目经验

_触发：`/sync-profile pull`_

1. 读取项目 `docs/LESSONS.md`
2. 对比种子包 `knowledge/` 对应分类文件，提取新增条目
3. AI 判断每条应归入哪个文件：
   - **确认的**（如与现有条目同类、版本范围明确）→ 自动归类，但**列出操作清单**供用户过目
   - **不确定的**（如版本不匹配、跨语言、新分类）→ 停下来问用户
4. 用户扫一眼清单，确认无误后执行写入
5. 更新 `seed.yaml` changelog

> **原则：AI 可以自动执行，但不能悄无声息。** 用户不一定要点确认，但一定要能看到做了什么。如果发现 AI 归错了类，用户有机会在写入前纠正。

### refresh — 同步种子包更新

_触发：`/sync-profile refresh`_

1. 对比 `seed.yaml` 版本号
2. 检测脚手架模板变更（如 `ARCHITECTURE.md` → `REFERENCE.md`）
3. 覆盖项目模板生成的部分
4. 保留项目自定义内容（LESSONS.md 中用户填的教训不动）
5. 如有模板变更，展示差异并确认

## 知识条目版本标签

`knowledge/` 中的每条经验使用统一标签标明适用范围：

```markdown
## RestTemplate 超时配置

**适用：** Spring Boot 1.5 ~ 2.x
**不适用：** Spring Boot 3.x（已改用 WebClient）

在 1.x 中通过 @Bean 配置...
```

AI 在 `init` 和 `refresh` 时根据这些标签筛选条目。生成的 LESSONS.md 顶部自动标注：

> ⚠️ 此项目使用 Spring Boot 1.5。标注了其他版本的条目仅供参考。

## 传输方式

整包复制，走 U 盘或共享文件夹。Skill 目录自身即是种子包：

```
sync-profile/          ← U盘/共享文件夹里的目录
├── SKILL.md
├── profile/
├── config/
├── knowledge/
└── scaffolds/
```

目标环境复制到 `.claude/skills/sync-profile/` 即可使用。

## 实现方式

- **Skill**（SKILL.md）：定义步骤，AI 执行
- **PowerShell 脚本**（可选）：放在 `scripts/` 子目录，辅助文件读写操作，由 Skill 调用
- **模板系统**：`.hbs` 文件是带占位符的 Markdown，AI 读取后替换变量生成正式文件
- **无需安装任何东西**，Win10 自带 PowerShell

## 后续可优化方向

（记录在此，不阻塞初始实现）

- 种子包加密（侧写含个人敏感信息）
- 模板变量支持运行时计算（如自动检测项目框架版本）
- 冲突合并策略细化

# sync-profile — 可复制的开发者知识系统

> 把你的个人侧写、AI 协作规则、踩坑记录打包成可跨环境复制的种子包。
>
> 推荐先看使用说明（浏览器打开）：`docs/superpowers/specs/sync-profile-intro.html`（如存在）

## 目录结构

```
sync-profile/
├── SKILL.md                    ← 本文件
├── seed.yaml                   ← 版本号 + changelog
├── profile/                    ← 个人侧写（跨环境通用）
├── config/                     ← 全局配置模板
├── knowledge/                  ← 踩坑记录（按语言/版本分层）
├── scaffolds/                  ← 项目骨架模板
└── scripts/                    ← PowerShell 辅助脚本
```

## 通用流程

1. 每个操作执行前，先确认种子包路径（默认是自身所在 `.claude/skills/sync-profile/`）
2. 涉及文件写入时，先展示差异再执行
3. 操作完成后更新 seed.yaml 的 changelog

---

## 操作一：init — 新项目初始化

**触发：** 用户输入 `/sync-profile init`

**步骤：**

1. 确认种子包路径（默认即可）
2. 问用户：项目语言类型（rust / java / node / other）
3. 问用户：框架/版本（如 spring-boot-1.5、tauri 2.0）
4. 读取 `knowledge/`，按语言和版本过滤，生成 `docs/LESSONS.md`：
   - 只复制匹配语言的知识目录
   - 从匹配的条目中，按 `**适用：**` 标签过滤当前版本适用的条目
   - 不匹配版本的条目在 LESSONS.md 中用引用块标注"仅供参考"
   - 开头添加版本警告：
     ```
     > ⚠️ 此项目使用 {框架/版本}。标注了其他版本的条目仅供参考，以 `**适用：**` 标签为准。
     ```
5. 选择 scaffolds/ 模板：匹配语言则用对应模板，否则用 `generic/`
6. 用 PowerShell 脚本 `scripts/generate-scaffold.ps1` 生成项目骨架
7. 运行 `scripts/merge-settings.ps1` 合并全局 settings.json
8. 生成 `.claude/settings.local.json`（从 scaffolds 模板）
9. 告知用户已完成，列出生成了哪些文件

---

## 操作二：pull — 回收项目经验

**触发：** 用户输入 `/sync-profile pull`

**步骤：**

1. 读取项目 `docs/LESSONS.md`，提取所有踩坑条目
2. 读取种子包 `knowledge/` 对应分类文件（根据项目语言确定分类）
3. 逐条对比，识别新增条目（内容去重）
4. 对每条新条目：
   - **确认的**（同类问题、版本范围明确，有现有文件可归入）→ 准备自动归类，记录到操作清单
   - **不确定的**（版本不匹配、跨语言、需要新建分类文件）→ 停下来问用户
5. 展示完整的操作清单（包含自动归类的条目和用户已确认的条目），让用户过目
6. 用户确认后，追加到对应 `knowledge/` 文件
7. 如果 pull 过程新增了文件，提示用户同步种子包到其他环境
8. 更新 `seed.yaml` changelog

---

## 操作三：refresh — 同步种子包更新

**触发：** 用户输入 `/sync-profile refresh`

**步骤：**

1. 读取种子包 `seed.yaml`，对比项目上次记录的版本
2. 如果没有版本记录，则认为是首次 refresh，全量覆盖
3. 检测 scaffolds/ 模板是否变更（对比文件名列表和内容）
4. 如果模板变更：
   - **新增文件** → 直接生成
   - **删除文件** → 询问用户是否删除项目对应文件
   - **内容变更** → 展示 diff，确认后覆盖
5. 保留用户自定义内容：
   - `docs/LESSONS.md` 中用户手写的条目不动（只覆盖顶部的自动生成部分）
   - `.claude/settings.local.json` 中用户自定义的权限保留（追加不覆盖）
6. 更新版本记录
7. 告知用户本次 refresh 变更了什么

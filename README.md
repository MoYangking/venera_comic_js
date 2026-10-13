# Venera-Next 漫画源仓库

本仓库面向 [Venera-Next](https://github.com/CyrilPeng/Venera-Next)，独立维护两个 JavaScript 漫画源：**nhentai.net** 和 **e-hentai.org（可切换 ExHentai）**。

仅提供漫画源代码和测试，不提供、镜像或下载任何站点内容，不附带账号、API Key 或 Cookie。请仅访问你有权使用的内容。

## 快速导入

在支持**漫画源仓库**的 Venera-Next 版本中，打开「漫画源」→「添加来源 / 漫画源列表」，输入：

```text
https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/index.json
```

如果你的版本仅支持**单个 JS 脚本**，可分别导入：

- [nhentai.js（Raw）](https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/nhentai.js)
- [ehentai.js（Raw）](https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/ehentai.js)

不同版本的界面可能不同。Venera-Next 的当前主分支支持 JSON 数组源目录，旧版可能只有脚本链接/文件导入。直接使用 `github.com/.../blob/...` 文件展示页无法导入脚本；需要使用上面的 Raw 地址。

> **覆盖已有来源时请注意**：本仓库的两个脚本保留上游 `nhentai` 和 `ehentai` 的 key，以维持漫画 ID、收藏和阅读记录的兼容，**不能和同 key 的旧源同时安装**。本次重构采用 `2.1.0` 版本号，导入前建议先备份阅读器数据。

## 当前功能

| 功能 | nhentai.net | E-Hentai / ExHentai |
| --- | --- | --- |
| 最新 / 热门 | 最新列表、热门作品 | 最新、热门、订阅列表 |
| 搜索 | API v2，分页、排序、语言筛选 | 游标分页、10 类别过滤、最低评分、语言筛选 |
| 排行 | 今日、本周、本月、全部 | 昨日、本月、今年、全部 |
| 详情与标签 | 完整标签分组、关联推荐、缩略图 | 标签、评分、上传日期、缩略图 |
| 阅读 | API v2 图片路径、Referer | 多页索引、按需解析原图 URL、失败刷新 |
| 账号 | 网页登录、可选 API Key | 网页登录、Cookie 登录 |
| 网络收藏 | 收藏/取消、在线收藏列表 | 多收藏夹、增删收藏、收藏列表 |
| 兼容性 | ID 不变、中文翻译 | 5 种列表布局、双域名、稳定 ID |

基础功能已通过离线模拟测试；2026-10-13 使用 JS 逆向 MCP4 对两站部分公开接口及页面进行了真实请求、DOM 与网络验证（详见 [站点实测报告](docs/live-site-findings.md)）。**依然不代表全部功能已完成真实网站或 Venera-Next 客户端集成测试**。在线收藏与账号功能依赖源站当前权限及 Cookie 状态。

## 使用提示

**nhentai**：在漫画源设置里可选填 API Key。部分搜索/收藏接口可能要求认证。若返回 `HTTP 401/403/429`，请检查当前网络、站点可访问性和账号状态；本插件不会规避人机验证或站点封锁。

**E-Hentai**：源设置提供 `e-hentai.org` 与 `exhentai.org` 两个域名；后者需要自己的有效账号及访问资格。浏览结果受站点登录状态、列表显示模式（紧凑/缩略图/扩展/精简/精简增强）和网络环境影响。打开画廊会先获取图片分页目录，阅读时再请求实际图片地址；对大型画廊，首次加载章节可能需要较多请求。

**图片加载**：两源都给图片请求设置来源页 Referer。E-Hentai 会缓存短时间内已解析的图片地址，并在图片失败时重新解析一次；这不能绕过配额、账号限制或验证码。

## 目录结构

```text
index.json                  # 仓库索引（键、文件名、版本与源码一致）
nhentai.js                  # nhentai API v2 源
 ehentai.js                 # E-Hentai / ExHentai 源
 tests/sources.test.cjs     # 离线模拟测试
 .github/workflows/validate.yml  # GitHub CI
CHANGELOG.md                # 更新记录
```

## 网页实测与限制

- nhentai：首页受到 Cloudflare Turnstile 验证（HTTP 403），但公开 API v2 列表、详情、热门、搜索、标签查询分别返回了正常 JSON（HTTP 200）；未登录收藏接口返回 HTTP 401。扩展不尝试绕过验证。
- E-Hentai：首页、搜索、详情、阅读页及五种列表布局可访问。搜索使用游标 `next`，详情缩略图当前常以 `#gdt.gt200` CSS 精灵图存在，图片阅读页通过 `#img` 提供地址。
- ExHentai：当前未登录会发生重定向并显示空页面；扩展会提示需要登录或相应访问权限。
- 实测参考仅代表 2026-10-13 当前网络环境，页面和接口可能再次改变；不能代替真机测试。

## 开发和验证

需要 Node.js 18+，不需要安装 npm 包：

```bash
npm test
node --check nhentai.js
node --check ehentai.js
```

修改脚本后，同时更新 `index.json` 中对应的 `version`。优先保持 `key` 和漫画 ID 不变，避免破坏历史记录。CI 每次 push / PR 自动运行静态语法检查和离线模拟测试。

**上线前仍需要在真正的 Venera-Next 客户端中验证**：安装、首屏、搜索和翻页、分类、详情、封面、单章首尾图片、离线下载、登录与在线收藏。尤其是网络环境、Cookie 和站点 HTML 可能影响运行。

## 参考与兼容性说明

- [Venera-Next 漫画源开发文档](https://github.com/CyrilPeng/Venera-Next/blob/main/doc/api/comic_source.zh.md)
- [Venera-Next JavaScript API](https://github.com/CyrilPeng/Venera-Next/blob/main/doc/api/js.zh.md)
- [venera-app/venera-configs](https://github.com/venera-app/venera-configs) —— 两个站点原有插件的行为参考
- [handahao666-boop/venera_comic_source](https://github.com/handahao666-boop/venera_comic_source) —— `index.json` 源目录及分发方式参考

本项目是独立的非官方维护分支。若网站对源的访问权限、页面布局或 API 作出调整，欢迎提交**脱敏**的 HTTP 状态、操作步骤、错误描述和无私人信息的页面结构；请勿提交 Cookie、访问令牌或版权作品内容。

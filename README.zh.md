---
description: "ctx.web 的腾讯元宝搜索提供方：通过专用 Search API 直接检索，返回可移植摘要、日期，并按每次搜索解析凭证。"
kind: "package-reference"
---

# dsh-web-search-yuanbao

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-yuanbao`，harness 可以通过腾讯元宝搜索检索 web，并从一次直接 API 请求中获得标题、URL、摘要与发布时间。当部署持有腾讯云 WSA API 密钥、并希望使用元宝搜索索引且不产生辅助模型轮次时，选择它。提供方把 `passage`（垂直结果则用 `content`）映射为 `snippet`，把服务日期格式归一化为 ISO-8601，并丢弃没有 URL 或摘要的条目。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用本包](#use-this-package)
- [开发](#development)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已加载 web 服务的组合中挂载本提供方；它以 `yuanbao` 搜索提供方身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——也可以用 `searchProvider: yuanbao` 固定。

### 安装到 profile

本包声明了 `dsh.bundle` 层，因此 `dsh plugin` 会安装它并自动加入提供方行：

```sh
dsh plugin --profile demo add ./dsh-web-search-yuanbao
```

该层把提供方插入到基础层的 `web` 行旁边。在 profile 自己的 `cordis.patch.yml` 中给该行设置 `searchProvider: yuanbao` 即可选用（或者让它成为唯一可用的搜索后端）。通过凭证服务存储密钥，或在启动环境中导出 `TENCENTCLOUD_WSA_APIKEY`。

### 何时选择

当部署持有腾讯云元宝搜索 API 密钥，并希望每个查询只发一次直接检索请求时，选择此后端。与 `dsh-web-search-deepseek` 不同，搜索不运行模型轮次，因此延迟与成本只取决于检索 API。端点基址无法解析时提供方不可用；配置 schema 会拒绝 10、20、30、40、50 以外的条数。缺少凭证则在搜索运行时报告。

### 最小配置

加载 web 服务与本提供方；挂载了 `ctx.credentials` 时密钥经其解析，否则回退到启动环境中的 `$TENCENTCLOUD_WSA_APIKEY`。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: 'dsh-web-search-yuanbao'
  config:
    apiKeyEnv: TENCENTCLOUD_WSA_APIKEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面 API 密钥；优先使用 `apiKeyEnv`，避免密钥进入配置文件 |
| `apiKeyEnv` | `TENCENTCLOUD_WSA_APIKEY` | 每次搜索解析的凭证引用；非空字面 `apiKey` 优先 |
| `baseURL` | `https://api.wsa.cloud.tencent.com` | 端点基址；追加 `/SearchPro`。无法解析时提供方不可用 |
| `count` | `10` | 请求不含上限时的每次搜索条数；取 10、20、30、40、50。不支持的值会使提供方不可用 |

生成的[配置目录](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md#deepseek-aidsh-web-search-yuanbao)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 搜索返回什么

每项可用页面映射为 `WebSearchSource`：`url`、存在时的 `title`、来自 `passage` 的 `snippet`（垂直结果回退到 `content`），以及归一化为 ISO-8601 的 `publishedAt`。垂直结果优先使用 `display` 信封中的 URL、标题与日期。没有 URL 或摘要的条目会被丢弃；服务不返回生成答案，因此 `content` 被省略。请求的 `maxResults` 会向上取整到最小的受支持 `Cnt`——上限 8 会发送 10——最终上限由 web 服务截断并标记。

### 失败与恢复

提供方失败——HTTP 错误、网络失败、无法解析或结构错误的主体，以及错误信封——呈现为 `WebError` `WEB_PROVIDER_ERROR`；被中止的请求呈现为 `WEB_ABORTED`；缺少密钥呈现为 `WEB_PROVIDER_CREDENTIAL_MISSING`。HTTP 重定向在联系 `Location` 目标之前被拒绝。提供方不重试，也不回退到其他后端。调用方按错误码路由；面向模型的 `web_search` 工具在自身错误包装层下把失败呈现给模型。

-----

<a id="development"></a>
## 开发

本项目是从 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) monorepo 中提取出的独立 `web-search-yuanbao` 包。它依赖已发布的 `0.2.1-rc.2` 版 `@deepseek-ai/dsh-*` 包，无需检出 monorepo。

需要 Node `^22.19.0 || >=24.0.0` 与 pnpm。

```sh
pnpm install
pnpm build        # 生成 lib/（JavaScript 与声明文件）
pnpm typecheck
pnpm test         # 单元测试
pnpm test:e2e     # 真实 API 冒烟测试；先设置 TENCENTCLOUD_WSA_APIKEY
```

单元测试把包名映射到 `src/index.ts`，因此 `pnpm test` 无需先构建即可直接测试源码。未设置密钥时 `pnpm test:e2e` 会自动跳过。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释提供方背后的设计决策；可观察行为已完整覆盖在[使用本包](#use-this-package)中。

### 设计理念

提供方是元宝 Search API 之上的薄适配层，遵循三条明确规则：

- **只做直接检索。** 每次搜索一次请求；与 Messages 后端的 DeepSeek 提供方不同，不产生辅助模型请求。
- **只接受可移植摘要。** 来源必须带有真实 URL 与摘要；从其他字段编造会让 seam 说谎，因此不可用条目被丢弃。
- **按搜索解析凭证。** 每次操作读取已存储的密钥，因此存储或轮换的密钥无需重启即可用于下一次搜索。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、凭证与环境解析、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `YuanbaoSearchProvider`：请求派发、响应解码、结果映射、中止分类 |
| [`src/types.ts`](src/types.ts) | 元宝 wire 类型：`YuanbaoSearchResponse`、`YuanbaoPage`、`YuanbaoError` |

### 请求与映射流程

`search()` 读取一次设置快照、解析凭证，然后以 `redirect: 'error'` 把 `{ Query, Cnt }` 发送到 `{baseURL}/SearchPro`，因此重定向不会联系目标就会失败。`Response.Pages` 的每个条目都从其 JSON 字符串解码；可用页面按顺序映射，不可用页面被丢弃。错误信封会变成 `WEB_PROVIDER_ERROR`，无法解释的主体同样如此。中止——名为 `AbortError` 的 `DOMException`——变成 `WEB_ABORTED`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够时，阅读这些页面。它们从共享词汇出发，依次介绍服务、面向模型的工具与设计依据。

- [Web 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web.zh.md)——穷尽式搜索请求／结果词汇与错误码。
- [Web 包地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/README.zh.md)——包家族与各自角色。
- [dsh-web](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web/README.zh.md)——本提供方注册到的 web 服务。
- [dsh-tool-web](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/tool-web/README.zh.md)——渲染本提供方来源的面向模型 `web_search` 工具。
- [生成的配置目录](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md#deepseek-aidsh-web-search-yuanbao)——每个受支持配置字段及其源码声明。
- [Web 能力 seam 决策](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——为什么搜索与抓取共用一个提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-web` 间接影响模型体验。该工具保留本提供方经 `maxResults` 限制的 URL、标题、摘要与 ISO-8601 日期；如果发生失败，则会在消费方的错误包装层内保留原样错误消息 `Yuanbao search aborted`、`Yuanbao search request failed: <error>`、`Yuanbao search credential resolution failed: <error>`、`Yuanbao returned an invalid response body`、`Yuanbao search has no API key for "<ref>"` 以及提供方错误信封消息。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明提供方在哪些情况下不合适。它们是当前包约束。

- **只有查询词与结果条数会到达服务**——seam 请求没有 site、mode、industry 或 freshness 字段，因此该 skill 的其他控制项要等待提供方无关的服务字段。
- **没有 URL 或摘要的条目会被整个丢弃**——返回来源可能少于请求数量。
- **动态凭证可用性在操作内部解析**——同步可用性检查无法查询凭证存储，因此被选中的无密钥提供方会在搜索时以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。
- **无法识别的日期会被省略**——`publishedAt` 必须是 ISO-8601，因此既不匹配 ISO 也不匹配 `YYYY/MM/DD HH:mm:ss` 的提供方值会被丢弃，而不是原样传递。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

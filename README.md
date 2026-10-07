# dsh-fish-tts

**中文 | [English](./README.en.md)**

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-fish-tts — DeepSeek Harness 语音合成插件（仅支持 Fish Audio API）" />
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/MaRi23333/dsh-fish-tts/ci.yml?style=flat-square&label=CI" alt="CI" />
  <img src="https://img.shields.io/github/license/MaRi23333/dsh-fish-tts?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-4d6bfe?style=flat-square" alt="DeepSeek Harness 0.2.0-rc.2" />
</p>

> **English:** dsh-fish-tts is a third-party **TTS plugin** for the
> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI —
> [Fish Audio](https://fish.audio) API only, bring your own key: a per-message
> "Read aloud" action, an auto-read toggle in the composer, and a settings page for
> model / voice / encrypted API key / proxy. Bilingual UI (zh/en). See
> [README.en.md](./README.en.md) for the full English version.

## 简介

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web GUI 的第三方**语音合成（TTS）插件**：为每条助手回复提供一键**朗读**，输入栏带**自动朗读**开关，模型 / 音色 / 加密 Key / 代理均可配置。**仅支持 [Fish Audio](https://fish.audio) API，需自备 API Key。** 使用你自己的 Fish 音色（`reference_id`，含自行**克隆**的音色）——朗读、试听都走你配置的**语音**。

### 30 秒对比：与常见 Edge TTS 朗读插件

| 对比项 | dsh-fish-tts（本插件） | 常见 Edge TTS 朗读插件 |
| --- | --- | --- |
| 合成引擎 | **Fish Audio 官方 API**（仅支持；需自备 Key） | 微软 Edge 内置语音 |
| 音色 | 你自己的音色 `reference_id`（含自行克隆的音色，须有使用权限） | Edge 内置固定音色库 |
| API Key | **必须自备**（设置页 AES-256-GCM 加密保存） | 无需 |
| 适合谁 | 已有 Fish Audio 账号、想要自己或克隆音色的用户 | 想免费快速试用、固定音色即可的用户 |

## 功能

- **朗读按钮**：每条定稿的助手消息操作条里有一个「朗读 / Read aloud」按钮（图标与原生操作条图标同风格），点击合成并播放该条回复；**播放中再次点击该消息的按钮即中断停止**（不会从头重播），点击其他消息的按钮则直接切换播放，合成等待中再点一次可取消。markdown 会被清洗：路径 / URL / 长编号 / 代码块不会读出来。
- **自动朗读**：输入框工具行的小喇叭开关（与设置页同步），开启后自动朗读页面加载后产生的新回复。
- **常用音色收藏**：为音色 ID 保存易辨识的名称和多行备注，从下拉列表直接切换并立即生效。收藏保存在本机；切换保留其他未保存设置，移除收藏也不会清空当前音色。
- **设置页**（Settings → 语音朗读 / Voice (Fish TTS)）：
  - TTS 模型（下拉建议 + 手动输入，支持 s2.1-pro-free / s2.1-pro / s2-pro 等，保存后立即生效；默认 s2.1-pro-free）
  - 音色 `reference_id`（可直接输入、修改或清空，无须收藏；合成需要有效 ID，插件不提供默认音色）
  - API Key（**AES-256-GCM 加密存储**在本机 `$DSH_HOME/fish-tts/settings.json`，密钥文件 `key.bin` 自动生成并在 Windows 上收紧 ACL；Key 不会出现在任何 GET 响应、日志或仓库中）
  - HTTP 代理（例如 `http://127.0.0.1:7890`，直连不通时可填）
  - 试听／停止试听按钮、自动朗读开关、音量滑条（默认 60%）、倍速滑条（0.5–2.0×，不变调；浏览器不支持时固定 1×）
- **双语界面**（中文 / English，跟随 DSH 语言设置；en 词条与 zh 完全对齐）。

## 界面截图

<p align="center">
  <img src="./assets/readme/screenshot-read-aloud.png" width="75%" alt="消息操作条上的朗读按钮" /><br>
  <em>消息操作条上的「朗读」按钮</em>
</p>

<p align="center">
  <img src="./assets/readme/screenshot-auto-read.png" width="75%" alt="输入栏的自动朗读开关" /><br>
  <em>输入栏的自动朗读开关</em>
</p>

<p align="center">
  <img src="./assets/readme/screenshot-settings.png" width="75%" alt="设置页示例：当前音色、常用音色切换、连接设置和播放偏好" /><br>
  <em>设置页：直接应用音色 ID、按名称切换收藏并试听；连接设置可折叠，播放偏好无须保存。截图中的音色仅用于展示，不随插件提供。</em>
</p>

## 宿主与桌面端兼容

开发侧于 2026-09-30 报告：`dsh-fish-tts 0.2.11` 在 DSH `0.2.0-rc.2` 与同版本桌面客户端中可用。插件沿用 Web 客户端接口；桌面客户端中的插件界面不需要另一份桌面专用包。

**0.2.12** 为插件管理页增加随客户端语言切换的中英文名称与简介，合成和设置逻辑不变。更新说明见 [CHANGELOG.md](./CHANGELOG.md)。

**0.2.13** 新增常用音色收藏，重新整理设置页流程与视觉风格，并修复播放归属、设置失败恢复和试听反馈。停止或切换会取消客户端请求，但不保证 Fish 上游已停止处理或计费。

此说明依据维护者的使用反馈，不代表所有操作系统或所有 Fish 模型均经过验证。在线合成仍需有效 API Key、可用音色和网络；宿主接口发生变化时需重新验证。

## 安装

一条命令，从 npm 安装（推荐）：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-fish-tts
```

然后**重启 dsh web**（关掉终端重新运行 `dsh web`）并刷新页面，打开 **Settings → 语音朗读**。

其他安装方式：

```sh
# 从 GitHub 安装（git-hosted 插件会在安装时构建）
npx @deepseek-ai/dsh plugin --profile web add github:MaRi23333/dsh-fish-tts

# 从本地目录安装
git clone https://github.com/MaRi23333/dsh-fish-tts.git
cd dsh-fish-tts
pnpm install && pnpm run build
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-fish-tts
```

> 仓库已提交 `lib/` 构建产物，git 安装无需本地构建；改源码后运行 `pnpm run build` 再重启即可。

> **从 GitHub 版换到 npm 源**：裸包名 `add dsh-fish-tts` 对已装的 git 版是静默空操作（pnpm 判定同名依赖已满足）。请改用 `npx @deepseek-ai/dsh plugin --profile web add dsh-fish-tts@latest`，或先 `remove` 再 `add`。

> 安装刚发布的 npm 版本时，pnpm 的供应链保护可能自动在 profile 的 `pnpm-workspace.yaml` 写入 `minimumReleaseAgeExclude: [dsh-fish-tts@…]`，属正常行为，不影响使用。

### 安装后验证

1. 打开 **Settings → 语音朗读**（Voice (Fish TTS)）；
2. 在「连接设置」填入你的 **API Key**，点击「保存连接设置」；
3. 在「音色 ID」中填写音色 **`reference_id`**，点击「应用音色」（无须填写名称或收藏）；
4. 点击「试听当前音色」——听到你的音色朗读测试句，安装即成功。

> 「试听当前音色」使用已保存的音色和连接设置，不会保存表单草稿；会请求试听音频，缓存未命中时调用 Fish Audio API。音色为空或没有可用 Key 时不可试听，等待和播放中均可停止。

### 收藏与切换常用音色

「音色 ID」始终显示，可以直接粘贴、修改并点击「应用音色」；删空输入后点击「清空音色」即可停用当前音色。这些操作只修改当前 ID，不要求收藏，也不影响已有收藏。ID 有未应用的修改时，先应用再试听。

收藏是可选的快捷切换方式。当前 ID 匹配收藏时显示名称和备注；在「切换音色」下拉列表选择名称即可立即切换，并将 ID 输入框更新为该音色。点击「收藏音色」或「给当前音色命名」打开独立表单，填写名称、ID 和可选备注，再点「添加并使用」。已有音色 ID 会继续保留，收藏最多 100 项。

展开「管理常用音色」可使用、编辑或移除音色。编辑只修改名称和备注，不会切换正在使用的音色；移除需确认，且不会清空当前音色。添加、编辑和切换都不会保存模型、代理或 API Key 的连接草稿。连接设置独立保存；播放偏好无须保存，音量和倍速用于后续朗读。

## 配置

首次使用：打开 Settings → 语音朗读，先保存连接设置（Fish Audio API Key、模型和可选代理），再输入并应用音色 ID，最后试听验证。保存后的设置**立即生效**，无需再次重启。

也可以在 profile 的 `cordis.patch.yml` 里给 `fish-tts` 行加 `config`（会被设置页保存的值覆盖）：

```yaml
- id: fish-tts
  config:
    model: s2.1-pro-free
    format: wav
    stateDir: /custom/state/dir
```

### 配置项

| Key | 默认 | 说明 |
| --- | --- | --- |
| `model` | `''` | 默认模型（设置页保存值优先） |
| `voice` | `''` | 默认音色 reference_id（设置页保存值优先） |
| `format` | `wav` | `wav` / `mp3` / `opus` / `pcm` |
| `apiKey` | `''` | 一般不填；优先使用设置页加密保存的 Key，其次环境变量 `FISH_API_KEY` |
| `apiKeyFile` | `''` | 读取指定 dotenv 文件的 `FISH_API_KEY` |
| `proxy` | `''` | HTTP(S) 代理（设置页保存值优先） |
| `stateDir` | `$DSH_HOME/fish-tts` | 设置/密钥文件目录 |

## 安全

- API Key 只以加密形态落盘（AES-256-GCM，每机随机密钥 `key.bin`，0600/ACL 收紧），不写入仓库、日志或任何 GET 响应。
- 写接口（synthesize/config）强制 `application/json` 并校验同源/loopback Origin，杜绝跨站表单盗刷。
- **仅本机使用**：所有 `/fish-tts/*` 路由拒绝非 loopback（127.0.0.1 / ::1 / ::ffff:127.0.0.1）来源的请求（403），即使宿主监听在 0.0.0.0 也不开放远程访问。
- **代理不支持带用户名密码的地址**（`http://user:pass@host:port` 会在保存时被拒绝）；环境变量 `HTTPS_PROXY`/`HTTP_PROXY` 若带凭据同样会被忽略（不泄露、无回退），请改用无凭据的代理或直连。
- 代理地址、模型、音色均为用户本机设置，仓库不携带任何个人信息。
- 合成请求的文本上限 12000 字符；结果在进程内缓存（最多 200 条），重启即清。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test       # node:test 单元/集成测试（上游 Fish API 使用本地 mock，不触网）
pnpm run build      # host: lib/index.js；client: lib/client.js（ModuleLoader CJS closure）
pnpm run smoke      # host 入口 + client ModuleLoader 冒烟
pnpm run check:pack # npm pack 内容白名单校验
```

> 要求 Node >= 22（Node 20 已 EOL）。CI（`.github/workflows/ci.yml`）在 Node 22 与 24 上执行全部门禁，并校验 `lib/` 构建产物与提交一致。

- host 侧在 `src/index.ts`（Node，注册 `/fish-tts/*` 路由与设置存储）
- client 侧在 `src/client/`（React，注册 `conversation.chat.assistant-actions`、`conversation.input.left`、`settings.section` 三个 slot）
- 开发依赖与 CI 类型检查基线仍为 DSH `0.1.2-rc.1`，其中的会话 API 与界面图标适配保留；当前宿主使用反馈见上方「宿主与桌面端兼容」。其他版本如接口漂移请对照 [deepseek-harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 相应 tag 调整。

## License

[MIT](./LICENSE)

### 合规与第三方声明

- 本项目是**第三方开源插件**，与 Fish Audio / Hanabi AI Inc. 无任何隶属、合作或背书关系。"Fish Audio" 为其权利人的商标，此处仅为描述性使用（说明本插件所对接的服务）。
- 本插件**不分发、不托管任何 API Key**；请使用你自己的 Fish Audio 账号与 Key，并妥善保管。
- Fish Audio **免费额度仅限个人、非商业用途**；商业使用请订阅官方付费套餐。详见 [Terms of Use](https://fish.audio/terms)。
- 仅可使用你有权使用的音色（reference_id）。未经授权，不得克隆或模仿公众人物、名人或他人的声音。详见 [Acceptable Use Policy](https://fishaudio.org/zh/acceptable-use)。
- 对外分发生成的音频时，建议主动披露其为 AI 合成内容，不得误导听众认为是真人真实发言。
- 使用本插件即表示你同意遵守 Fish Audio 的全部服务条款；条款如有更新，以官方页面为准。

---

*独立社区项目，与 DeepSeek 无隶属关系，亦未经其认可。DeepSeek 与 DeepSeek Harness 商标归各自所有者所有。*
*Independent community project — not affiliated with or endorsed by DeepSeek.*

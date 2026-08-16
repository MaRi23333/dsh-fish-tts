# dsh-plugin-fish-tts

Fish Audio 语音朗读插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。
给 Web GUI 增加：每条助手消息的「朗读」按钮、输入栏的自动朗读开关、以及可编辑模型 / 音色 / API Key / 代理的设置页。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds
Fish Audio read-aloud to the Web GUI: a per-message "Read aloud" action, an
auto-read toggle in the composer, and a settings page for model / voice /
encrypted API key / proxy.

## 功能 Features

- **朗读按钮**：每条定稿的助手消息操作条里有一个「朗读 / Read aloud」按钮，点击合成并播放该条回复（markdown 会被清理：路径/URL/长编号/代码块不会读出来）。
- **自动朗读**：输入框工具行的小喇叭开关（与设置页同步），开启后自动朗读页面加载后产生的新回复。
- **设置页**（Settings → 语音朗读 / Voice (Fish TTS)）：
  - TTS 模型（下拉建议 + 手动输入，支持 s2.1-pro-free / s2.1-pro / s2-pro 等，保存后立即生效；默认 s2.1-pro-free）
  - 音色 `reference_id`（**必填**：音色是个人数据，插件不提供默认音色；未填写时合成会被拒绝并提示）
  - API Key（**AES-256-GCM 加密存储**在本机 `$DSH_HOME/fish-tts/settings.json`，密钥文件 `key.bin` 自动生成并在 Windows 上收紧 ACL；Key 不会出现在任何 GET 响应、日志或仓库中）
  - HTTP 代理（例如 `http://127.0.0.1:7890`，直连不通时可填）
  - 试听按钮、自动朗读开关、音量滑条（默认 60%）
- 双语界面（中文 / English，跟随 DSH 语言设置）。

## 安装 Install

```sh
# 从 GitHub 安装（git-hosted 插件会在安装时构建）
dsh plugin --profile web add github:MaRi23333/dsh-plugin-fish-tts

# 或从本地目录安装
git clone https://github.com/MaRi23333/dsh-plugin-fish-tts.git
cd dsh-plugin-fish-tts
pnpm install && pnpm run build
dsh plugin --profile web add /absolute/path/to/dsh-plugin-fish-tts
```

然后**重启 dsh web**（关掉终端重新运行 `dsh web`）并刷新页面。

> 仓库已提交 `lib/` 构建产物，git 安装无需本地构建；改源码后运行 `pnpm run build` 再重启即可。

Then **restart `dsh web`** (stop the process, run `dsh web` again) and refresh the page.

## 配置 Configuration

首次使用：打开 Settings → 语音朗读，填模型、音色、API Key（Fish Audio 的 key），必要时填代理，保存后用「试听」验证。所有设置在保存后**立即生效**，无需再次重启。

也可以在 profile 的 `cordis.patch.yml` 里给 `fish-tts` 行加 `config`（会被设置页保存的值覆盖）：

```yaml
- id: fish-tts
  config:
    model: s2.1-pro-free
    format: wav
    stateDir: /custom/state/dir
```

### 配置项 Config keys

| Key | 默认 | 说明 |
| --- | --- | --- |
| `model` | `''` | 默认模型（设置页保存值优先） |
| `voice` | `''` | 默认音色 reference_id（设置页保存值优先） |
| `format` | `wav` | `wav` / `mp3` / `opus` / `pcm` |
| `apiKey` | `''` | 一般不填；优先使用设置页加密保存的 Key，其次环境变量 `FISH_API_KEY` |
| `apiKeyFile` | `''` | 读取指定 dotenv 文件的 `FISH_API_KEY` |
| `proxy` | `''` | HTTP(S) 代理（设置页保存值优先） |
| `stateDir` | `$DSH_HOME/fish-tts` | 设置/密钥文件目录 |

## 安全 Security

- API Key 只以加密形态落盘（AES-256-GCM，每机随机密钥 `key.bin`，0600/ACL 收紧），不写入仓库、日志或任何 GET 响应。
- 写接口（synthesize/config）强制 `application/json` 并校验同源/loopback Origin，杜绝跨站表单盗刷。
- **仅本机使用**：所有 `/fish-tts/*` 路由拒绝非 loopback（127.0.0.1 / ::1 / ::ffff:127.0.0.1）来源的请求（403），即使宿主监听在 0.0.0.0 也不开放远程访问。
- **代理不支持带用户名密码的地址**（`http://user:pass@host:port` 会在保存时被拒绝）；环境变量 `HTTPS_PROXY`/`HTTP_PROXY` 若带凭据同样会被忽略（不泄露、无回退），请改用无凭据的代理或直连。
- 代理地址、模型、音色均为用户本机设置，仓库不携带任何个人信息。
- 合成请求的文本上限 12000 字符；结果在进程内缓存（最多 200 条），重启即清。

## 开发 Develop

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
- 依赖 DSH `0.1.0-rc.6` 的运行时 API；其他版本如接口漂移请对照 [deepseek-harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 相应 tag 调整。

## License

[MIT](./LICENSE)

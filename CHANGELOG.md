# 更新记录 / Changelog

## 0.3.0（2026-10-22）

- 将网络请求依赖 Undici 升级到 `7.30.1`，包含上游 2026 年 10 月的安全修复，声明下限同步为 `^7.30.1`。
- Updated the HTTP dependency Undici to `7.30.1`, including upstream security fixes from October 2026, and raised the declared minimum to `^7.30.1`.
- 补充工具默认启用与额度提示；无效通道注册立即拒绝，成功日志不再记录会话或通道标识。
- Clarified default enablement and quota usage; invalid channel registrations are rejected immediately, and success logs no longer include session or channel identifiers.

- 新增智能体可调用的音频生成工具 `fish_tts_speak`：把台词生成为音频文件；所在会话接了聊天通道时，文件交由通道插件投递为语音条。台词清洗、每会话限频、响度与文件生命周期都在本插件，通道只注册投递器并保留自己的出站过滤。
- Added the agent-callable audio-generation tool `fish_tts_speak`: spoken lines become audio files; when the session has a chat channel attached, the file is handed to the channel plugin for delivery as a voice bubble. Line cleaning, per-conversation rate limiting, loudness and the file lifecycle live in this plugin; channels only register a delivery hook and keep their own outbound filtering.
- 台词处理以现网事故为防线：Fish 情绪/声音方括号标签原样透传（严禁剥掉方括号），括号动作/旁白（（尾巴晃来晃去）、"(tail wagging)"）在合成前删除、不会被念出来，只清理代码块、URL、markdown 符号、emoji 与括号旁白；未知英文标签形 token 静默忽略，中文引用类方括号内容永不误删。
- Speech-line processing pins the incident class: Fish bracket tags pass through verbatim (brackets are never stripped); parenthetical stage directions (（尾巴晃来晃去）, "(tail wagging)") are removed before synthesis so they are never read aloud; only code blocks, URLs, markdown symbols, emoji and those asides are removed. Unknown English-tag-shaped tokens are dropped silently; CJK bracketed content is never touched.
- 每会话每分钟上限（默认 1，0 为停用）先占槽后合成、失败释放，防并发绕过；错误携带剩余秒数并区分 rate-limited / text-too-long / auth / quota / network / voice-rejected 等模型可读代码；合成 15 秒总预算、投递 20 秒硬顶，取消后绝不投递。
- The per-conversation per-minute limit (default 1; 0 disables) claims the send slot before synthesis and releases it on failure, closing the concurrent bypass. Errors carry remaining seconds and distinct model-readable codes (rate-limited / text-too-long / auth / quota / network / voice-rejected, …); synthesis is capped at 15 s total, delivery at 20 s, and nothing is delivered after cancellation.
- 响度归一化由 Fish Audio 服务端完成（`prosody.normalize_loudness`，s1 系模型不支持），附 -20~+20 dB 音量微调；设置页新增「音频生成（智能体调用）」分组（开关、格式、上限、限频、响度、音量微调，即改即生效），作为折叠分组置于设置页末尾——朗读核心功能保持原位，原有「音量」行名称不变，仅就近补一行说明。
- Loudness is normalized server-side by Fish Audio (`prosody.normalize_loudness`; unsupported on s1 models) with a -20..+20 dB volume trim. The settings page gains an "Audio generation (agent calls)" group (toggle, format, limits, rate, loudness, trim — effective immediately), collapsed and placed last like an add-on: read-aloud stays front and center, and the existing "Volume" row keeps its name with a short note beside it.
- 跨通道投递经 `ctx.fishTts.registerDelivery(channel, { claims?, deliver })` 注册：`claims` 声明会话归属，`deliver` 内执行通道出站过滤后发送，拒收即报 `voice-rejected` 且不落文件；未投递时音频保留在 `$DSH_HOME/fish-tts/out/`（24 小时 TTL 顺手清理），工具结果只含长度、格式与投递状态，不含绝对路径与台词。
- Channels register through `ctx.fishTts.registerDelivery(channel, { claims?, deliver })`: `claims` declares session ownership, `deliver` runs the channel's outbound filter before sending, and a rejection surfaces as `voice-rejected` with no file left behind. Undelivered audio stays in `$DSH_HOME/fish-tts/out/` (24 h opportunistic TTL); tool results carry sizes, format and delivery status only — no absolute paths, no spoken content.

## 0.2.13（2026-10-07）

- 常用音色可保存名称和多行备注，下拉选择后立即生效；移除收藏保留当前音色，兼容原设置与加密 Key。
- Save voices with names and multiline notes, switch immediately by name, and remove bookmarks without clearing the active voice. Existing settings and encrypted keys are preserved.
- 重整设置页流程：首屏显示当前音色与切换入口，添加、编辑、移除和连接设置各自独立；首次使用给出配置指引，操作结果就近显示。
- Redesign settings around the current voice and switching, with separate add/edit/remove and connection flows, first-use guidance and feedback beside each action.
- 音色 ID 常驻并可直接输入、修改或清空，无须名称或收藏；仅匹配收藏时显示当前名称，手工应用只保存 ID。
- Keep the voice ID visible and directly editable or clearable without a name or bookmark. Show the current name only for matching bookmarks; manual application saves only the ID.
- 修复清空音色后重新启用配置文件预设音色的问题；明确清空会持久保留，缺省设置仍兼容配置回退。
- Preserve an explicit voice clear across restarts instead of reviving a configured default. An absent stored voice still falls back to configuration.
- 视觉风格参考个性化指令编辑器：透明卡片、柔和细边框、蓝色主按钮和紧凑间距；常态减少辅助文案。试听等待可取消，离开设置页会停止该次试听。
- Match the instruction editor's transparent cards, subtle borders, blue primary buttons and compact spacing, with less persistent helper text. Cancel pending tests and stop test playback when leaving settings.
- 修复相同文本消息共用播放状态，改为按消息 ID 归属；播放状态即时订阅，停止／切换中止客户端在途请求并忽略旧结果。
- Track playback by message ID, update controls through subscriptions, and abort superseded browser requests while ignoring their late results.
- 保存失败不会改变内存配置；设置加载失败可重试且禁写；试听只使用已保存配置，显示失败提示并支持停止，不会顺带保存草稿。
- Failed saves leave effective settings unchanged. Failed loads can be retried without overwriting settings; testing uses saved settings, reports failures and supports stopping without saving drafts.
- 自动朗读开关在同源窗口间于下一条消息同步；浏览器存储不可用或写入失败时，偏好仍可在本次会话使用。
- Auto-read changes are picked up across same-origin windows on the next message; the preference remains usable for the current session if browser storage is unavailable or a write fails.

## 0.2.12（2026-10-04）

- 插件列表和详情页新增中英文名称与简介，随 DeepSeek Harness 界面语言切换。
- Added localized English and Chinese names and descriptions for the plugin list and detail page.
- 仅修改插件元数据；Fish Audio 合成、播放、设置与密钥存储逻辑未变。 / Metadata only; synthesis, playback, settings, and key storage are unchanged.

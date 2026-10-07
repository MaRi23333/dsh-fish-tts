# 更新记录 / Changelog

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

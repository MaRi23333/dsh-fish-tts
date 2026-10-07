/**
 * Locale namespace declaration and bilingual dictionaries for dsh-fish-tts.
 * The namespace merge into LocaleNamespaceMap is what makes the slot-level
 * `locale: 'fish-tts'` seat and the typed `t` prop work.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export type FishTtsKey =
  | 'action.speak'
  | 'action.speak.aria'
  | 'action.stop'
  | 'action.failed'
  | 'error.voiceRequired'
  | 'input.toggle'
  | 'input.toggle.on'
  | 'input.toggle.off'
  | 'settings.label'
  | 'settings.title'
  | 'settings.intro'
  | 'settings.saving'
  | 'settings.cancel'
  | 'settings.loading'
  | 'settings.loadFailed'
  | 'settings.modelsFailed'
  | 'settings.retry'
  | 'settings.model'
  | 'settings.model.hint'
  | 'settings.voice'
  | 'settings.voice.required'
  | 'settings.voice.hint'
  | 'settings.voice.placeholder'
  | 'settings.voice.apply'
  | 'settings.voice.clear'
  | 'settings.voice.applied'
  | 'settings.voice.cleared'
  | 'settings.voice.unapplied'
  | 'settings.voices'
  | 'settings.voices.choose'
  | 'settings.voices.unsaved'
  | 'settings.voices.hint'
  | 'settings.voices.name'
  | 'settings.voices.name.placeholder'
  | 'settings.voices.note'
  | 'settings.voices.note.placeholder'
  | 'settings.voices.save'
  | 'settings.voices.remove'
  | 'settings.voices.idRequired'
  | 'settings.voices.nameRequired'
  | 'settings.voices.tooLong'
  | 'settings.voices.limit'
  | 'settings.voices.section'
  | 'settings.voices.current'
  | 'settings.voices.unnamed'
  | 'settings.voices.showId'
  | 'settings.voices.editCurrent'
  | 'settings.voices.empty'
  | 'settings.voices.firstHint'
  | 'settings.voices.addFirst'
  | 'settings.voices.nameCurrent'
  | 'settings.voices.add'
  | 'settings.voices.addOther'
  | 'settings.voices.use'
  | 'settings.voices.edit'
  | 'settings.voices.saveEdit'
  | 'settings.voices.added'
  | 'settings.voices.edited'
  | 'settings.voices.switched'
  | 'settings.voices.removed'
  | 'settings.voices.manage'
  | 'settings.voices.listEmpty'
  | 'settings.voices.inUse'
  | 'settings.voices.confirmRemove'
  | 'settings.voices.removeHint'
  | 'settings.voices.confirm'
  | 'settings.voices.duplicate'
  | 'settings.voices.idReadOnly'
  | 'settings.voices.idTooLong'
  | 'settings.voices.nameTooLong'
  | 'settings.voices.noteTooLong'
  | 'settings.voices.finishEdit'
  | 'settings.voices.noLongerSaved'
  | 'settings.connection.title'
  | 'settings.connection.firstStep'
  | 'settings.connection.configure'
  | 'settings.connection.save'
  | 'settings.connection.saved'
  | 'settings.connection.keyClearedEnv'
  | 'settings.connection.keyCleared'
  | 'settings.connection.unsaved'
  | 'settings.connection.review'
  | 'settings.apiKey'
  | 'settings.apiKey.placeholder'
  | 'settings.apiKey.newPlaceholder'
  | 'settings.apiKey.clear'
  | 'settings.proxy'
  | 'settings.proxy.hint'
  | 'settings.proxy.placeholder'
  | 'settings.save'
  | 'settings.saved'
  | 'settings.saveFailed'
  | 'settings.status.keyOk'
  | 'settings.status.keyMissing'
  | 'settings.autoplay'
  | 'settings.autoplay.hint'
  | 'settings.volume'
  | 'settings.speed'
  | 'settings.speed.unsupported'
  | 'settings.test'
  | 'settings.test.playing'
  | 'settings.test.stop'
  | 'settings.test.failed'
  | 'settings.test.savedConnection'
  | 'settings.preferences.title'
  | 'settings.preferences.hint'
  | 'settings.sourceHint'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'fish-tts': FishTtsKey
  }
}

export const zh: Record<FishTtsKey, string> = {
  'action.speak': '朗读',
  'action.speak.aria': '朗读这条回复',
  'action.stop': '停止',
  'action.failed': '语音合成失败',
  'error.voiceRequired': '请先在语音设置中填写并应用音色 ID',
  'input.toggle': '自动朗读新回复',
  'input.toggle.on': '自动朗读已开启，点击关闭',
  'input.toggle.off': '自动朗读已关闭，点击开启',
  'settings.label': '语音朗读 (Fish TTS)',
  'settings.title': '语音合成（Fish Audio）',
  'settings.intro': '选择 AI 回复的声音，随时试听或自动朗读。',
  'settings.saving': '正在保存…',
  'settings.cancel': '取消',
  'settings.loading': '正在加载设置…',
  'settings.loadFailed': '无法加载设置，请重试',
  'settings.modelsFailed': '模型列表暂不可用，仍可手动输入模型 ID。',
  'settings.retry': '重试',
  'settings.model': 'TTS 模型（可手动输入）',
  'settings.model.hint': '如 s2.1-pro-free、s2.1-pro、s2-pro，可手动输入',
  'settings.voice': '音色 ID',
  'settings.voice.required': '音色 ID（必填）',
  'settings.voice.hint': '从 Fish Audio 音色页复制 ID。',
  'settings.voice.placeholder': '粘贴 Fish Audio 音色 ID',
  'settings.voice.apply': '应用音色',
  'settings.voice.clear': '清空音色',
  'settings.voice.applied': '音色已应用',
  'settings.voice.cleared': '音色已清空',
  'settings.voice.unapplied': '音色 ID 有未应用的修改，请先应用后试听。',
  'settings.voices': '切换音色',
  'settings.voices.choose': '选择常用音色',
  'settings.voices.unsaved': '当前音色尚未收藏',
  'settings.voices.hint': '选择后立即使用；其余未保存的设置会保留。',
  'settings.voices.name': '音色名称（必填）',
  'settings.voices.name.placeholder': '例如：温柔旁白',
  'settings.voices.note': '音色备注（可选）',
  'settings.voices.note.placeholder': '声音特点或用途，最多 500 字',
  'settings.voices.save': '添加并使用',
  'settings.voices.remove': '移除',
  'settings.voices.idRequired': '请填写音色 ID',
  'settings.voices.nameRequired': '请填写音色名称',
  'settings.voices.tooLong': '音色名称最多 80 字，备注最多 500 字',
  'settings.voices.limit': '最多收藏 100 个音色，请先移除不需要的收藏',
  'settings.voices.section': '音色',
  'settings.voices.current': '正在使用：',
  'settings.voices.unnamed': '尚未命名的音色',
  'settings.voices.showId': '查看音色 ID',
  'settings.voices.editCurrent': '编辑名称和备注',
  'settings.voices.empty': '还没有设置音色',
  'settings.voices.firstHint': '第一次复制音色 ID 并保存名称，以后就能直接切换。',
  'settings.voices.addFirst': '添加第一个音色',
  'settings.voices.nameCurrent': '给当前音色命名',
  'settings.voices.add': '收藏音色',
  'settings.voices.addOther': '添加其他音色',
  'settings.voices.use': '使用',
  'settings.voices.edit': '编辑',
  'settings.voices.saveEdit': '保存修改',
  'settings.voices.added': '已添加并使用：',
  'settings.voices.edited': '已保存音色修改：',
  'settings.voices.switched': '已切换音色：',
  'settings.voices.removed': '已移除收藏：',
  'settings.voices.manage': '管理常用音色',
  'settings.voices.listEmpty': '收藏的音色会显示在这里。',
  'settings.voices.inUse': '正在使用',
  'settings.voices.confirmRemove': '移除这个收藏',
  'settings.voices.removeHint': '只从常用列表移除，正在使用的音色仍然可用。',
  'settings.voices.confirm': '确认移除',
  'settings.voices.duplicate': '这个音色已添加，请编辑已有音色。',
  'settings.voices.idReadOnly': '音色 ID 不变，可选中复制。',
  'settings.voices.idTooLong': '音色 ID 最多 256 个字符',
  'settings.voices.nameTooLong': '音色名称最多 80 个字符',
  'settings.voices.noteTooLong': '音色备注最多 500 个字符',
  'settings.voices.finishEdit': '请先保存或取消当前音色表单，再进行这项操作。',
  'settings.voices.noLongerSaved': '这个收藏已不存在，请取消后重新选择。',
  'settings.connection.title': '连接设置',
  'settings.connection.firstStep': '先保存 API Key，再填写并应用音色 ID 即可试听。',
  'settings.connection.configure': '设置 API Key',
  'settings.connection.save': '保存连接设置',
  'settings.connection.saved': '连接设置已保存',
  'settings.connection.keyClearedEnv': '已清除本机保存的 Key，环境配置的 Key 仍可使用。',
  'settings.connection.keyCleared': '已清除本机保存的 Key',
  'settings.connection.unsaved': '有未保存的修改',
  'settings.connection.review': '查看连接改动',
  'settings.apiKey': 'API Key',
  'settings.apiKey.placeholder': '已有 Key，留空保持不变',
  'settings.apiKey.newPlaceholder': '粘贴 Fish Audio API Key',
  'settings.apiKey.clear': '清除已保存的 Key',
  'settings.proxy': '网络代理（可选）',
  'settings.proxy.hint': '如 http://127.0.0.1:7890，留空为直连；不支持带用户名密码的代理地址',
  'settings.proxy.placeholder': '留空直连，或 http://127.0.0.1:7890',
  'settings.save': '保存设置',
  'settings.saved': '已保存，立即生效',
  'settings.saveFailed': '保存失败',
  'settings.status.keyOk': 'API Key 已配置',
  'settings.status.keyMissing': '未配置 API Key',
  'settings.autoplay': '新回复自动朗读',
  'settings.autoplay.hint': '仅自动朗读页面打开后产生的新回复，不会重播历史消息。',
  'settings.volume': '音量',
  'settings.speed': '播放速度',
  'settings.speed.unsupported': '当前浏览器不支持倍速播放，已固定为 1×',
  'settings.test': '试听当前音色',
  'settings.test.playing': '正在生成试听语音，可点击停止试听取消…',
  'settings.test.stop': '停止试听',
  'settings.test.failed': '试听失败',
  'settings.test.savedConnection': '当前试听使用已保存的连接设置。',
  'settings.preferences.title': '播放偏好（无须保存）',
  'settings.preferences.hint': '无须保存，应用于后续朗读。',
  'settings.sourceHint': '设置保存在本机 $DSH_HOME/fish-tts/，API Key 使用 AES-256-GCM 加密存储。',
}

export const en: Record<FishTtsKey, string> = {
  'action.speak': 'Read aloud',
  'action.speak.aria': 'Read this reply aloud',
  'action.stop': 'Stop',
  'action.failed': 'Speech synthesis failed',
  'error.voiceRequired': 'Enter and apply a voice ID in the voice settings first',
  'input.toggle': 'Auto-read new replies',
  'input.toggle.on': 'Auto-read is on, click to turn off',
  'input.toggle.off': 'Auto-read is off, click to turn on',
  'settings.label': 'Voice (Fish TTS)',
  'settings.title': 'Text-to-speech (Fish Audio)',
  'settings.intro': 'Choose a voice for AI replies, preview it, or read replies automatically.',
  'settings.saving': 'Saving…',
  'settings.cancel': 'Cancel',
  'settings.loading': 'Loading settings…',
  'settings.loadFailed': 'Unable to load settings; please retry',
  'settings.modelsFailed': 'The model list is unavailable. You can still enter a model ID manually.',
  'settings.retry': 'Retry',
  'settings.model': 'TTS model (you can type an ID)',
  'settings.model.hint': 'e.g. s2.1-pro-free, s2.1-pro, s2-pro — free to type any id',
  'settings.voice': 'Voice ID',
  'settings.voice.required': 'Voice ID (required)',
  'settings.voice.hint': 'Copy the ID from the Fish Audio voice page.',
  'settings.voice.placeholder': 'Paste a Fish Audio voice ID',
  'settings.voice.apply': 'Apply voice',
  'settings.voice.clear': 'Clear voice',
  'settings.voice.applied': 'Voice applied',
  'settings.voice.cleared': 'Voice cleared',
  'settings.voice.unapplied': 'The voice ID has unapplied changes. Apply them before previewing.',
  'settings.voices': 'Switch voice',
  'settings.voices.choose': 'Choose a saved voice',
  'settings.voices.unsaved': 'The current voice is not saved',
  'settings.voices.hint': 'Selecting a voice applies it immediately and keeps your other unsaved settings.',
  'settings.voices.name': 'Voice name (required)',
  'settings.voices.name.placeholder': 'For example: Warm narrator',
  'settings.voices.note': 'Voice note (optional)',
  'settings.voices.note.placeholder': 'Voice qualities or intended use, up to 500 characters',
  'settings.voices.save': 'Add and use',
  'settings.voices.remove': 'Remove',
  'settings.voices.idRequired': 'Enter a voice ID',
  'settings.voices.nameRequired': 'Enter a voice name',
  'settings.voices.tooLong': 'Voice names allow up to 80 characters and notes up to 500 characters',
  'settings.voices.limit': 'You can save up to 100 voices. Remove an unused voice first.',
  'settings.voices.section': 'Voice',
  'settings.voices.current': 'Using: ',
  'settings.voices.unnamed': 'Unnamed voice',
  'settings.voices.showId': 'Show voice ID',
  'settings.voices.editCurrent': 'Edit name and note',
  'settings.voices.empty': 'No voice set up yet',
  'settings.voices.firstHint': 'Copy a voice ID and save a name once. After that, switch voices directly.',
  'settings.voices.addFirst': 'Add your first voice',
  'settings.voices.nameCurrent': 'Name the current voice',
  'settings.voices.add': 'Save voice',
  'settings.voices.addOther': 'Add another voice',
  'settings.voices.use': 'Use',
  'settings.voices.edit': 'Edit',
  'settings.voices.saveEdit': 'Save changes',
  'settings.voices.added': 'Added and now using: ',
  'settings.voices.edited': 'Voice changes saved: ',
  'settings.voices.switched': 'Voice switched to: ',
  'settings.voices.removed': 'Removed saved voice: ',
  'settings.voices.manage': 'Manage saved voices',
  'settings.voices.listEmpty': 'Saved voices will appear here.',
  'settings.voices.inUse': 'In use',
  'settings.voices.confirmRemove': 'Remove saved voice',
  'settings.voices.removeHint': 'This removes it from the saved list. The current voice remains available.',
  'settings.voices.confirm': 'Confirm removal',
  'settings.voices.duplicate': 'This voice is already saved. Edit the existing voice instead.',
  'settings.voices.idReadOnly': 'The voice ID stays the same. You can select and copy it.',
  'settings.voices.idTooLong': 'Voice IDs allow up to 256 characters',
  'settings.voices.nameTooLong': 'Voice names allow up to 80 characters',
  'settings.voices.noteTooLong': 'Voice notes allow up to 500 characters',
  'settings.voices.finishEdit': 'Save or cancel the current voice form before doing this.',
  'settings.voices.noLongerSaved': 'This saved voice no longer exists. Cancel and choose a voice again.',
  'settings.connection.title': 'Connection settings',
  'settings.connection.firstStep': 'Save your API key, then enter and apply a voice ID to preview it.',
  'settings.connection.configure': 'Set up API key',
  'settings.connection.save': 'Save connection settings',
  'settings.connection.saved': 'Connection settings saved',
  'settings.connection.keyClearedEnv': 'The locally saved key was cleared. The environment key is still available.',
  'settings.connection.keyCleared': 'Locally saved key cleared',
  'settings.connection.unsaved': 'Unsaved changes',
  'settings.connection.review': 'Review connection changes',
  'settings.apiKey': 'API key',
  'settings.apiKey.placeholder': 'A key is configured; leave empty to keep it',
  'settings.apiKey.newPlaceholder': 'Paste a Fish Audio API key',
  'settings.apiKey.clear': 'Clear saved key',
  'settings.proxy': 'HTTP proxy (optional)',
  'settings.proxy.hint': 'e.g. http://127.0.0.1:7890, empty for direct; proxy URLs with username/password are not supported',
  'settings.proxy.placeholder': 'Leave empty for direct, or http://127.0.0.1:7890',
  'settings.save': 'Save settings',
  'settings.saved': 'Saved, effective immediately',
  'settings.saveFailed': 'Save failed',
  'settings.status.keyOk': 'API key configured',
  'settings.status.keyMissing': 'No API key configured',
  'settings.autoplay': 'Read new replies automatically',
  'settings.autoplay.hint': 'Only replies that arrive after this page loaded are read automatically; history is never replayed.',
  'settings.volume': 'Volume',
  'settings.speed': 'Playback speed',
  'settings.speed.unsupported': 'This browser does not support pitch-preserving speed control; playback stays at 1×',
  'settings.test': 'Preview current voice',
  'settings.test.playing': 'Preparing audio… Select Stop preview to cancel.',
  'settings.test.stop': 'Stop preview',
  'settings.test.failed': 'Test playback failed',
  'settings.test.savedConnection': 'This preview uses the saved connection settings.',
  'settings.preferences.title': 'Playback preferences (no save needed)',
  'settings.preferences.hint': 'No save needed. These apply to subsequent playback.',
  'settings.sourceHint': 'Settings live in $DSH_HOME/fish-tts/ on this machine; the API key is encrypted with AES-256-GCM.',
}

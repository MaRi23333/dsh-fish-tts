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
  | 'settings.model'
  | 'settings.model.hint'
  | 'settings.voice'
  | 'settings.voice.hint'
  | 'settings.voice.placeholder'
  | 'settings.apiKey'
  | 'settings.apiKey.placeholder'
  | 'settings.apiKey.clear'
  | 'settings.proxy'
  | 'settings.proxy.hint'
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
  'error.voiceRequired': '请先在设置页填写音色 ID',
  'input.toggle': '自动朗读新回复',
  'input.toggle.on': '自动朗读已开启，点击关闭',
  'input.toggle.off': '自动朗读已关闭，点击开启',
  'settings.label': '语音朗读 (Fish TTS)',
  'settings.title': '语音合成（Fish Audio）',
  'settings.model': 'TTS 模型',
  'settings.model.hint': '如 s2.1-pro-free、s2.1-pro、s2-pro，可手动输入',
  'settings.voice': '音色 reference_id（必填）',
  'settings.voice.hint': '你自己的 Fish Audio 音色 ID；未填写时无法合成语音',
  'settings.voice.placeholder': '32 位十六进制音色 ID',
  'settings.apiKey': 'API Key',
  'settings.apiKey.placeholder': '已保存（留空保持不变）',
  'settings.apiKey.clear': '清除已保存的 Key',
  'settings.proxy': '网络代理',
  'settings.proxy.hint': '如 http://127.0.0.1:7890，留空为直连；不支持带用户名密码的代理地址',
  'settings.save': '保存设置',
  'settings.saved': '已保存，立即生效',
  'settings.saveFailed': '保存失败',
  'settings.status.keyOk': 'API Key 已配置',
  'settings.status.keyMissing': '未配置 API Key（在下方输入并保存）',
  'settings.autoplay': '新回复自动朗读',
  'settings.autoplay.hint': '仅自动朗读页面打开后产生的新回复，不会重播历史消息。',
  'settings.volume': '音量',
  'settings.speed': '播放速度',
  'settings.speed.unsupported': '当前浏览器不支持倍速播放，已固定为 1×',
  'settings.test': '试听',
  'settings.test.playing': '正在播放测试语音…',
  'settings.sourceHint': '设置保存在本机 $DSH_HOME/fish-tts/，API Key 使用 AES-256-GCM 加密存储。',
}

export const en: Record<FishTtsKey, string> = {
  'action.speak': 'Read aloud',
  'action.speak.aria': 'Read this reply aloud',
  'action.stop': 'Stop',
  'action.failed': 'Speech synthesis failed',
  'error.voiceRequired': 'Set a voice reference_id in the settings page first',
  'input.toggle': 'Auto-read new replies',
  'input.toggle.on': 'Auto-read is on, click to turn off',
  'input.toggle.off': 'Auto-read is off, click to turn on',
  'settings.label': 'Voice (Fish TTS)',
  'settings.title': 'Text-to-speech (Fish Audio)',
  'settings.model': 'TTS model',
  'settings.model.hint': 'e.g. s2.1-pro-free, s2.1-pro, s2-pro — free to type any id',
  'settings.voice': 'Voice reference_id (required)',
  'settings.voice.hint': 'Your own Fish Audio voice id; synthesis is refused while empty',
  'settings.voice.placeholder': '32-char hex voice id',
  'settings.apiKey': 'API key',
  'settings.apiKey.placeholder': 'Saved (leave empty to keep)',
  'settings.apiKey.clear': 'Clear saved key',
  'settings.proxy': 'HTTP proxy',
  'settings.proxy.hint': 'e.g. http://127.0.0.1:7890, empty for direct; proxy URLs with username/password are not supported',
  'settings.save': 'Save settings',
  'settings.saved': 'Saved, effective immediately',
  'settings.saveFailed': 'Save failed',
  'settings.status.keyOk': 'API key configured',
  'settings.status.keyMissing': 'No API key configured (enter and save below)',
  'settings.autoplay': 'Read new replies automatically',
  'settings.autoplay.hint': 'Only replies that arrive after this page loaded are read automatically; history is never replayed.',
  'settings.volume': 'Volume',
  'settings.speed': 'Playback speed',
  'settings.speed.unsupported': 'This browser does not support pitch-preserving speed control; playback stays at 1×',
  'settings.test': 'Test',
  'settings.test.playing': 'Playing test audio…',
  'settings.sourceHint': 'Settings live in $DSH_HOME/fish-tts/ on this machine; the API key is encrypted with AES-256-GCM.',
}

window.__ModuleLoader__.load({ id: "dsh-fish-tts", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/tts.ts
/** Browser-local playback volume (0..1), default quieter than full blast. */
const VOLUME_KEY = "fish-tts.volume";
const DEFAULT_VOLUME = .6;
function getVolume() {
	try {
		const raw = window.localStorage.getItem(VOLUME_KEY);
		if (raw === null) return DEFAULT_VOLUME;
		const value = Number(raw);
		return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
	} catch {
		return DEFAULT_VOLUME;
	}
}
function setVolume(value) {
	try {
		const clamped = Math.min(1, Math.max(0, value));
		window.localStorage.setItem(VOLUME_KEY, String(clamped));
	} catch {}
}
/** Browser-local playback speed (0.5..2.0), applied per new clip. */
const SPEED_KEY = "fish-tts.speed";
const DEFAULT_SPEED = 1;
const MIN_SPEED = .5;
const MAX_SPEED = 2;
/**
* Whether pitch-preserving rate control is available. Modern browsers all
* ship `preservesPitch` (defaulting to true); where it is missing the
* settings row is disabled and playback stays at 1x rather than chipmunking.
*/
function speedSupported() {
	try {
		return typeof HTMLAudioElement !== "undefined" && "playbackRate" in HTMLAudioElement.prototype && "preservesPitch" in HTMLAudioElement.prototype;
	} catch {
		return false;
	}
}
function getSpeed() {
	try {
		const raw = window.localStorage.getItem(SPEED_KEY);
		if (raw === null || raw.trim() === "") return DEFAULT_SPEED;
		const value = Number(raw);
		if (!Number.isFinite(value) || value < MIN_SPEED || value > MAX_SPEED) return DEFAULT_SPEED;
		return value;
	} catch {
		return DEFAULT_SPEED;
	}
}
function setSpeed(value) {
	try {
		const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
		window.localStorage.setItem(SPEED_KEY, String(clamped));
	} catch {}
}
/**
* Apply the stored playback rate to a fresh clip. Pitch preservation is
* requested explicitly; where the browser lacks it the rate stays at the
* default 1x rather than chipmunking.
*/
function applySpeed(audio) {
	if (!speedSupported()) return;
	audio.preservesPitch = true;
	const speed = getSpeed();
	audio.defaultPlaybackRate = speed;
	audio.playbackRate = speed;
}
const REPL_EN = Object.freeze({
	link: "link",
	path: "path",
	id: "id",
	code: "code",
	codeBlock: "code block omitted"
});
const REPL_ZH = Object.freeze({
	link: "链接",
	path: "路径",
	id: "编号",
	code: "长代码",
	codeBlock: "代码块，已省略"
});
/** Strip markdown syntax that does not belong in spoken audio. */
function cleanForTts(text, repl = REPL_EN) {
	return text.replace(/https?:\/\/[^\s<>"|]+/g, repl.link).replace(/[A-Za-z]:\\[^\s<>"|]+/g, repl.path).replace(/(^|[\s(（])(?:~\/|\.{0,2}\/)[^\s<>"|]+/g, `$1${repl.path}`).replace(/\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/g, repl.id).replace(/\b[0-9a-fA-F]{16,}\b/g, repl.id).replace(/[A-Za-z0-9+/=_-]{24,}/g, repl.code).replace(/```[\s\S]*?```/g, ` ${repl.codeBlock} `).replace(/`([^`\n]+)`/g, "$1").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^>\s?/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/^\s*---+\s*$/gm, "").replace(/<[^>]+>/g, " ").replace(/(\*\*|__|~~|\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
var FishTtsPlayer = class {
	current = null;
	currentUrl = null;
	currentOwner = null;
	pendingOwner = null;
	request = null;
	listeners = /* @__PURE__ */ new Set();
	/** Generation counter; stop() and each play() bump it to invalidate
	*  in-flight synthesis, so a superseded fetch result never starts audio. */
	playToken = 0;
	/** Pause the current clip and release its blob URL (no token bump). */
	halt() {
		if (this.current !== null) {
			this.current.pause();
			this.current = null;
		}
		if (this.currentUrl !== null) {
			URL.revokeObjectURL(this.currentUrl);
			this.currentUrl = null;
		}
		this.currentOwner = null;
	}
	/** Notify controls immediately, without per-message polling. */
	notify() {
		for (const listener of this.listeners) try {
			listener();
		} catch {}
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Stop whatever is playing and cancel any in-flight synthesis. */
	stop() {
		this.playToken += 1;
		this.request?.abort();
		this.request = null;
		this.pendingOwner = null;
		this.halt();
		this.notify();
	}
	stopFor(owner) {
		if (this.currentOwner === owner || this.pendingOwner === owner) this.stop();
	}
	get playing() {
		return this.current !== null && !this.current.paused && !this.current.ended;
	}
	/** Owners identify messages, even when two messages contain identical text. */
	playingFor(owner) {
		return this.playing && this.currentOwner === owner;
	}
	pendingFor(owner) {
		return this.pendingOwner === owner;
	}
	/**
	* Synthesize and play one text.
	* @param text - raw markdown text of the reply (cleaned internally).
	* @param repl - spoken placeholder words for the active locale.
	* @param owner - message identity, or an independent owner for a test clip.
	*/
	async play(text, repl = REPL_EN, owner = text) {
		const cleaned = cleanForTts(text, repl);
		if (cleaned === "") return;
		const token = ++this.playToken;
		this.request?.abort();
		this.halt();
		const request = new AbortController();
		this.request = request;
		this.pendingOwner = owner;
		this.notify();
		try {
			const response = await fetch("/fish-tts/synthesize", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: cleaned }),
				signal: request.signal
			});
			if (token !== this.playToken) return;
			if (!response.ok) {
				let message = response.statusText;
				let code = "synthesis-failed";
				try {
					const payload = await response.json();
					message = payload.message ?? payload.error ?? message;
					if (payload.error !== void 0) code = payload.error;
				} catch {}
				const error = new Error(message);
				error.code = code;
				throw error;
			}
			const blob = await response.blob();
			if (token !== this.playToken) return;
			const url = URL.createObjectURL(blob);
			this.currentUrl = url;
			const audio = new Audio(url);
			audio.volume = getVolume();
			applySpeed(audio);
			this.current = audio;
			this.currentOwner = owner;
			const finished = () => {
				if (this.current === audio) {
					this.halt();
					this.notify();
				}
			};
			audio.addEventListener("ended", finished, { once: true });
			audio.addEventListener("error", finished, { once: true });
			await audio.play();
		} catch (error) {
			if (token !== this.playToken || request.signal.aborted) return;
			this.halt();
			throw error;
		} finally {
			if (token === this.playToken) {
				this.request = null;
				this.pendingOwner = null;
				this.notify();
			}
		}
	}
	/** Fetch the host status card. */
	async status() {
		try {
			const response = await fetch("/fish-tts/status", { cache: "no-store" });
			if (!response.ok) return {
				ok: false,
				error: `HTTP ${response.status}`
			};
			return await response.json();
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "status fetch failed"
			};
		}
	}
	/** Fetch the editable config (never includes the key). */
	async config() {
		try {
			const response = await fetch("/fish-tts/config", { cache: "no-store" });
			if (!response.ok) return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
				savedVoices: [],
				error: `HTTP ${response.status}`
			};
			const payload = await response.json();
			return {
				...payload,
				savedVoices: payload.savedVoices ?? []
			};
		} catch (error) {
			return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
				savedVoices: [],
				error: error instanceof Error ? error.message : "config fetch failed"
			};
		}
	}
	/** Persist an edit patch; empty strings clear, undefined keeps. */
	async saveConfig(patch) {
		try {
			const response = await fetch("/fish-tts/config", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch)
			});
			const payload = await response.json();
			if (!response.ok || payload.ok !== true) return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
				savedVoices: [],
				error: payload.message ?? payload.error ?? `HTTP ${response.status}`
			};
			return {
				...payload,
				savedVoices: payload.savedVoices ?? []
			};
		} catch (error) {
			return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
				savedVoices: [],
				error: error instanceof Error ? error.message : "config save failed"
			};
		}
	}
	/** Fetch selectable TTS model ids (live API list with curated fallback). */
	async models() {
		try {
			const response = await fetch("/fish-tts/models", { cache: "no-store" });
			if (!response.ok) return [];
			const payload = await response.json();
			return Array.isArray(payload.models) ? payload.models : [];
		} catch {
			return [];
		}
	}
};

//#endregion
//#region src/client/icons.tsx
function SpeakerIcon({ muted = false, playing = false }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		width: "16",
		height: "16",
		viewBox: "0 0 16 16",
		fill: "none",
		"aria-hidden": "true",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M2.6 6.9H5.1L8.2 4V12L5.1 9.1H2.6Z",
			stroke: "currentColor",
			strokeWidth: "1.35",
			strokeLinejoin: "round"
		}), muted ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M10.1 6.3l3.5 3.5M13.6 6.3l-3.5 3.5",
			stroke: "currentColor",
			strokeWidth: "1.3",
			strokeLinecap: "round"
		}) : playing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M10.25 6.27A2.2 2.2 0 0 1 10.25 9.73",
			stroke: "currentColor",
			strokeWidth: "1.3",
			strokeLinecap: "round"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M11.36 4.85A4 4 0 0 1 11.36 11.15",
			stroke: "currentColor",
			strokeWidth: "1.3",
			strokeLinecap: "round"
		})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M10.25 6.27A2.2 2.2 0 0 1 10.25 9.73",
			stroke: "currentColor",
			strokeWidth: "1.3",
			strokeLinecap: "round"
		})]
	});
}

//#endregion
//#region src/client/FishTtsActions.tsx
/** Text of the finalized assistant message addressed by the owner. */
function selectText(snapshot, messageId) {
	for (const raw of snapshot.nodes) {
		const node = raw;
		if (node.kind !== "assistant" || node.messageId !== messageId) continue;
		return (node.blocks ?? []).filter((block) => block.kind === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
	}
	return "";
}
/** Whether the addressed message is the latest finalized assistant message. */
function selectIsLatest(snapshot, messageId) {
	let latest = null;
	for (const raw of snapshot.nodes) {
		const node = raw;
		if (node.kind !== "assistant" || node.messageId === void 0) continue;
		const order = {
			turn: node.turn ?? 0,
			step: node.step ?? 0,
			seq: node.seq ?? 0
		};
		if (latest === null || order.turn > latest.turn || order.turn === latest.turn && order.step > latest.step || order.turn === latest.turn && order.step === latest.step && order.seq > latest.seq) latest = {
			...order,
			messageId: node.messageId
		};
	}
	return latest !== null && latest.messageId === messageId;
}
/** Finalized timestamp of the addressed message (0 when not found). */
function selectTime(snapshot, messageId) {
	for (const raw of snapshot.nodes) {
		const node = raw;
		if (node.kind === "assistant" && node.messageId === messageId) return node.time ?? 0;
	}
	return 0;
}
function FishTtsActions(props) {
	const { messageId, useChat, play, stop, playingFor, pendingFor, subscribePlayer, autoPlayEnabled, loadTime, played, t } = props;
	const text = useChat((s) => selectText({ nodes: s.legacy.nodes }, messageId));
	const isLatest = useChat((s) => selectIsLatest({ nodes: s.legacy.nodes }, messageId));
	const time = useChat((s) => selectTime({ nodes: s.legacy.nodes }, messageId));
	const [failure, setFailure] = (0, react.useState)(null);
	const busy = (0, react.useSyncExternalStore)(subscribePlayer, () => pendingFor(messageId), () => false);
	const isPlaying = (0, react.useSyncExternalStore)(subscribePlayer, () => playingFor(messageId), () => false);
	const alive = (0, react.useRef)(true);
	const operation = (0, react.useRef)(0);
	(0, react.useEffect)(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	(0, react.useEffect)(() => {
		if (!autoPlayEnabled()) return;
		if (!isLatest || text.trim() === "" || time <= loadTime) return;
		if (played.has(messageId)) return;
		played.add(messageId);
		play(text, messageId).catch(() => {
			played.delete(messageId);
		});
	}, [
		isLatest,
		text,
		time,
		messageId,
		play,
		autoPlayEnabled,
		loadTime,
		played
	]);
	if (text.trim() === "") return null;
	const onSpeak = () => {
		const token = ++operation.current;
		if (pendingFor(messageId) || playingFor(messageId)) {
			stop(messageId);
			setFailure(null);
			return;
		}
		setFailure(null);
		play(text, messageId).catch((error) => {
			if (!alive.current || token !== operation.current) return;
			setFailure(error.code === "voice-required" ? t("error.voiceRequired") : t("action.failed"));
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		"aria-label": isPlaying || busy ? t("action.stop") : t("action.speak.aria"),
		"data-active": isPlaying || void 0,
		title: failure ?? (isPlaying || busy ? t("action.stop") : t("action.speak")),
		onClick: onSpeak,
		style: {
			background: "none",
			border: "none",
			padding: "0 2px",
			cursor: "pointer",
			opacity: busy ? .55 : 1,
			display: "inline-flex",
			alignItems: "center",
			color: failure !== null ? "var(--dsh-color-danger, #e5484d)" : "var(--dsw-alias-label-tertiary, #7a7a7a)"
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { playing: isPlaying || busy })
	}) });
}

//#endregion
//#region src/client/FishTtsInputToggle.tsx
function FishTtsInputToggle(props) {
	const { autoPlayEnabled, setAutoPlay, subscribeAutoPlay, t } = props;
	const [enabled, setEnabled] = (0, react.useState)(autoPlayEnabled());
	(0, react.useEffect)(() => subscribeAutoPlay(() => {
		setEnabled(autoPlayEnabled());
	}), [subscribeAutoPlay, autoPlayEnabled]);
	const toggle = () => {
		setAutoPlay(!enabled);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		"aria-label": t("input.toggle"),
		"aria-pressed": enabled,
		"data-active": enabled || void 0,
		title: enabled ? t("input.toggle.on") : t("input.toggle.off"),
		onClick: toggle,
		style: {
			background: "none",
			border: "none",
			cursor: "pointer",
			padding: "2px 3px",
			display: "inline-flex",
			alignItems: "center",
			color: enabled ? "var(--dsh-color-primary, #4d6bfe)" : "inherit",
			opacity: enabled ? 1 : .55
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { muted: !enabled })
	});
}

//#endregion
//#region src/client/FishTtsSettings.tsx
const monoFont = "Consolas, Menlo, Monaco, monospace";
const colors = {
	text: "var(--dsw-alias-label-primary, inherit)",
	secondary: "rgba(128, 128, 128, 0.85)",
	border: "rgba(128, 128, 128, 0.35)",
	borderInput: "rgba(128, 128, 128, 0.4)",
	divider: "rgba(128, 128, 128, 0.2)",
	error: "var(--dsw-alias-state-error-primary, #dc2626)",
	success: "var(--dsw-alias-state-success-primary, #16a34a)",
	primary: "rgba(37, 99, 235, 0.95)"
};
const cardStyle = {
	minWidth: 0,
	padding: "12px",
	border: `1px solid ${colors.border}`,
	borderRadius: "8px",
	background: "transparent",
	display: "flex",
	flexDirection: "column",
	gap: "8px"
};
const stackStyle = {
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	minWidth: 0
};
const actionsStyle = {
	display: "flex",
	flexWrap: "wrap",
	alignItems: "center",
	gap: "8px",
	minWidth: 0
};
const hintStyle = {
	margin: 0,
	fontSize: "14px",
	lineHeight: 1.5,
	opacity: .75,
	overflowWrap: "anywhere"
};
const errorStyle = {
	margin: 0,
	fontSize: "12px",
	lineHeight: 1.5,
	color: colors.error,
	overflowWrap: "anywhere"
};
const headingStyle = {
	margin: 0,
	fontSize: "15px",
	lineHeight: 1.5,
	fontWeight: 600
};
const fieldStyle = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	minWidth: 0
};
const inputStyle = {
	boxSizing: "border-box",
	width: "100%",
	minWidth: 0,
	fontFamily: "inherit",
	fontSize: "14px",
	lineHeight: 1.5,
	padding: "5px 10px",
	border: `1px solid ${colors.borderInput}`,
	borderRadius: "6px",
	background: "transparent",
	color: "inherit"
};
const monoInputStyle = {
	...inputStyle,
	fontFamily: monoFont
};
const buttonStyle = (disabled, variant = "default") => {
	const isPrimary = variant === true || variant === "primary";
	const isDanger = variant === "danger";
	return {
		boxSizing: "border-box",
		maxWidth: "100%",
		minWidth: 0,
		minHeight: "32px",
		padding: isPrimary ? "4px 14px" : "4px 12px",
		fontFamily: "inherit",
		fontSize: "14px",
		lineHeight: 1.5,
		border: isPrimary ? "1px solid transparent" : isDanger ? "1px solid rgba(220, 38, 38, 0.55)" : `1px solid ${colors.borderInput}`,
		borderRadius: "6px",
		background: isPrimary ? colors.primary : "transparent",
		color: isPrimary ? "#fff" : isDanger ? colors.error : "inherit",
		cursor: disabled ? "default" : "pointer",
		opacity: disabled ? .45 : 1,
		overflowWrap: "anywhere"
	};
};
const feedbackOkStyle = {
	margin: 0,
	fontSize: "13px",
	lineHeight: 1.5,
	padding: "6px 10px",
	borderRadius: "6px",
	background: "rgba(22, 163, 74, 0.12)",
	border: "1px solid rgba(22, 163, 74, 0.4)",
	color: "inherit",
	overflowWrap: "anywhere"
};
const feedbackErrorStyle = {
	margin: 0,
	fontSize: "13px",
	lineHeight: 1.5,
	padding: "6px 10px",
	borderRadius: "6px",
	background: "rgba(220, 38, 38, 0.12)",
	border: "1px solid rgba(220, 38, 38, 0.45)",
	color: "inherit",
	overflowWrap: "anywhere"
};
function FeedbackMessage({ feedback }) {
	if (feedback === null) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		role: feedback.error ? "alert" : "status",
		"aria-live": "polite",
		style: feedback.error ? feedbackErrorStyle : feedbackOkStyle,
		children: feedback.message
	});
}
function FishTtsSettings(props) {
	const { t, test, playing, stopTest, subscribePlayer, autoPlay, setAutoPlay, subscribeAutoPlay, volume, setVolume: setVolume$1, speed, setSpeed: setSpeed$1, speedSupported: speedSupported$1, config, saveConfig, models } = props;
	const ids = (0, react.useId)();
	const isTestPlaying = (0, react.useSyncExternalStore)(subscribePlayer, playing, () => false);
	const [savedConfig, setSavedConfig] = (0, react.useState)(null);
	const [manualVoiceDraft, setManualVoiceDraft] = (0, react.useState)("");
	const [manualVoiceFeedback, setManualVoiceFeedback] = (0, react.useState)(null);
	const [connectionDraft, setConnectionDraft] = (0, react.useState)({
		model: "",
		proxy: "",
		apiKey: ""
	});
	const [connectionOpen, setConnectionOpen] = (0, react.useState)(false);
	const [connectionFeedback, setConnectionFeedback] = (0, react.useState)(null);
	const [voiceEditor, setVoiceEditor] = (0, react.useState)(null);
	const [voiceErrors, setVoiceErrors] = (0, react.useState)({});
	const [voiceFeedback, setVoiceFeedback] = (0, react.useState)(null);
	const [managementFeedback, setManagementFeedback] = (0, react.useState)(null);
	const [pendingRemoval, setPendingRemoval] = (0, react.useState)(null);
	const [modelOptions, setModelOptions] = (0, react.useState)([]);
	const [modelsError, setModelsError] = (0, react.useState)(false);
	const [loading, setLoading] = (0, react.useState)(true);
	const [loadAttempt, setLoadAttempt] = (0, react.useState)(0);
	const [loadError, setLoadError] = (0, react.useState)(null);
	const [savingAction, setSavingAction] = (0, react.useState)(null);
	const [enabled, setEnabled] = (0, react.useState)(autoPlay());
	const [vol, setVol] = (0, react.useState)(volume());
	const [spd, setSpd] = (0, react.useState)(speed());
	const [testing, setTesting] = (0, react.useState)(false);
	const [testError, setTestError] = (0, react.useState)(null);
	const persisted = (0, react.useRef)(null);
	const savingLock = (0, react.useRef)(false);
	const testingLock = (0, react.useRef)(false);
	const alive = (0, react.useRef)(true);
	const latestStopTest = (0, react.useRef)(stopTest);
	latestStopTest.current = stopTest;
	const nameInput = (0, react.useRef)(null);
	const keyInput = (0, react.useRef)(null);
	const connectionDetails = (0, react.useRef)(null);
	const focusKey = (0, react.useRef)(false);
	const speedOk = speedSupported$1();
	(0, react.useEffect)(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			latestStopTest.current();
		};
	}, []);
	(0, react.useEffect)(() => subscribeAutoPlay(() => {
		if (alive.current) setEnabled(autoPlay());
	}), [subscribeAutoPlay, autoPlay]);
	(0, react.useEffect)(() => {
		if (connectionOpen && focusKey.current) {
			focusKey.current = false;
			keyInput.current?.focus();
		}
	}, [connectionOpen]);
	(0, react.useEffect)(() => {
		let cancelled = false;
		persisted.current = null;
		setSavedConfig(null);
		setLoading(true);
		setLoadError(null);
		(async () => {
			try {
				const result = await config();
				if (cancelled || !alive.current) return;
				if (!result.ok) {
					setLoadError(result.message ?? result.error ?? t("settings.loadFailed"));
					return;
				}
				persisted.current = result;
				setSavedConfig(result);
				setManualVoiceDraft(result.voice);
				setConnectionDraft({
					model: result.model,
					proxy: result.proxy,
					apiKey: ""
				});
				setConnectionOpen(!result.keyConfigured);
			} catch (error) {
				if (!cancelled && alive.current) setLoadError(error instanceof Error ? error.message : t("settings.loadFailed"));
			} finally {
				if (!cancelled && alive.current) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [config, loadAttempt]);
	(0, react.useEffect)(() => {
		let cancelled = false;
		setModelsError(false);
		(async () => {
			try {
				const ids$1 = await models();
				if (cancelled || !alive.current) return;
				setModelOptions(ids$1);
				setModelsError(ids$1.length === 0);
			} catch {
				if (!cancelled && alive.current) setModelsError(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [models, loadAttempt]);
	const savedVoices = savedConfig?.savedVoices ?? [];
	const activeVoice = savedConfig?.voice.trim() ?? "";
	const currentVoice = savedVoices.find((entry) => entry.id === activeVoice);
	const keyConfigured = savedConfig?.keyConfigured === true;
	const manualVoiceDirty = savedConfig !== null && manualVoiceDraft.trim() !== activeVoice;
	const connectionDirty = savedConfig !== null && (connectionDraft.model !== savedConfig.model || connectionDraft.proxy !== savedConfig.proxy || connectionDraft.apiKey.trim() !== "");
	const fieldsDisabled = savedConfig === null || loading || savingAction !== null || testing;
	const canStopTest = isTestPlaying || testing;
	const testDisabled = !canStopTest && (fieldsDisabled || manualVoiceDirty || activeVoice === "" || !keyConfigured);
	const duplicateVoice = voiceEditor?.mode === "add" ? savedVoices.find((entry) => entry.id === voiceEditor.id.trim()) : void 0;
	const canWrite = () => alive.current && persisted.current !== null && !savingLock.current && !testingLock.current;
	const persistPatch = async (patch, action, fail) => {
		if (!canWrite()) return null;
		savingLock.current = true;
		setSavingAction(action);
		try {
			const result = await saveConfig(patch);
			if (!alive.current) return null;
			if (!result.ok) {
				fail(result.message ?? result.error ?? t("settings.saveFailed"));
				return null;
			}
			persisted.current = result;
			setSavedConfig(result);
			return result;
		} catch (error) {
			if (alive.current) fail(error instanceof Error ? error.message : t("settings.saveFailed"));
			return null;
		} finally {
			savingLock.current = false;
			if (alive.current) setSavingAction(null);
		}
	};
	const editConnection = (field, value) => {
		setConnectionDraft((draft) => ({
			...draft,
			[field]: value
		}));
		setConnectionFeedback(null);
	};
	const openConnection = (shouldFocusKey) => {
		if (shouldFocusKey && connectionOpen) keyInput.current?.focus();
		else focusKey.current = shouldFocusKey;
		setConnectionOpen(true);
		connectionDetails.current?.scrollIntoView({ block: "start" });
	};
	const onSaveConnection = async () => {
		if (!canWrite()) return;
		setConnectionFeedback(null);
		const patch = {
			model: connectionDraft.model,
			proxy: connectionDraft.proxy
		};
		if (connectionDraft.apiKey.trim() !== "") patch.apiKey = connectionDraft.apiKey.trim();
		const result = await persistPatch(patch, "connection", (message) => setConnectionFeedback({
			message,
			error: true
		}));
		if (result === null || !alive.current) return;
		setConnectionDraft({
			model: result.model,
			proxy: result.proxy,
			apiKey: ""
		});
		setConnectionFeedback({ message: t("settings.connection.saved") });
	};
	const onClearKey = async () => {
		if (!canWrite() || persisted.current?.hasStoredKey !== true) return;
		setConnectionFeedback(null);
		const result = await persistPatch({ clearKey: true }, "clearKey", (message) => setConnectionFeedback({
			message,
			error: true
		}));
		if (result === null || !alive.current) return;
		setConnectionFeedback({ message: t(result.keyConfigured ? "settings.connection.keyClearedEnv" : "settings.connection.keyCleared") });
		if (!result.keyConfigured) setConnectionOpen(true);
	};
	const onApplyManualVoice = async () => {
		const current = persisted.current;
		const voice = manualVoiceDraft.trim();
		if (!canWrite() || current === null || voice === current.voice.trim()) return;
		setManualVoiceFeedback(null);
		if (manualVoiceDraft.length > 256) {
			setManualVoiceFeedback({
				message: t("settings.voices.idTooLong"),
				error: true
			});
			return;
		}
		setVoiceFeedback(null);
		setTestError(null);
		const result = await persistPatch({ voice }, "manualVoice", (message) => setManualVoiceFeedback({
			message,
			error: true
		}));
		if (result === null || !alive.current) return;
		setManualVoiceDraft(result.voice);
		setManualVoiceFeedback({ message: t(result.voice.trim() === "" ? "settings.voice.cleared" : "settings.voice.applied") });
	};
	const onSelectVoice = async (id) => {
		const current = persisted.current;
		if (!canWrite() || id === "" || !current?.savedVoices.some((entry) => entry.id === id)) return;
		setManualVoiceFeedback(null);
		setVoiceFeedback(null);
		setManagementFeedback(null);
		setTestError(null);
		if (id === current.voice.trim()) {
			setManualVoiceDraft(current.voice);
			return;
		}
		const result = await persistPatch({ voice: id }, "switch", (message) => setVoiceFeedback({
			message,
			error: true
		}));
		if (result === null || !alive.current) return;
		setManualVoiceDraft(result.voice);
		const name = result.savedVoices.find((entry) => entry.id === result.voice.trim())?.name ?? result.voice.trim();
		setVoiceFeedback({ message: `${t("settings.voices.switched")}${name}` });
	};
	const openVoiceEditor = (editor) => {
		if (fieldsDisabled) return;
		if (voiceEditor !== null) {
			setVoiceErrors((errors) => ({
				...errors,
				form: t("settings.voices.finishEdit")
			}));
			nameInput.current?.focus();
			return;
		}
		setVoiceFeedback(null);
		setManagementFeedback(null);
		setVoiceErrors({});
		setVoiceEditor(editor);
	};
	const openAddVoice = (id = "") => openVoiceEditor({
		mode: "add",
		id,
		name: "",
		note: ""
	});
	const openEditVoice = (entry) => openVoiceEditor({
		mode: "edit",
		...entry
	});
	const updateVoiceEditor = (field, value) => {
		setVoiceEditor((editor) => editor === null || field === "id" && editor.mode === "edit" ? editor : {
			...editor,
			[field]: value
		});
		setVoiceErrors((errors) => ({
			...errors,
			[field]: void 0,
			form: void 0
		}));
	};
	const cancelVoiceEditor = () => {
		setVoiceEditor(null);
		setVoiceErrors({});
	};
	const onSaveVoice = async () => {
		const current = persisted.current;
		if (!canWrite() || voiceEditor === null || current === null) return;
		const { mode } = voiceEditor;
		const id = voiceEditor.id.trim();
		const name = voiceEditor.name.trim();
		const note = voiceEditor.note.trim();
		const errors = {};
		if (id === "") errors.id = t("settings.voices.idRequired");
		else if (voiceEditor.id.length > 256) errors.id = t("settings.voices.idTooLong");
		if (name === "") errors.name = t("settings.voices.nameRequired");
		else if (voiceEditor.name.length > 80) errors.name = t("settings.voices.nameTooLong");
		if (voiceEditor.note.length > 500) errors.note = t("settings.voices.noteTooLong");
		const existing = current.savedVoices.find((entry$1) => entry$1.id === id);
		if (mode === "add" && existing !== void 0) errors.id = t("settings.voices.duplicate");
		if (mode === "add" && current.savedVoices.length >= 100) errors.form = t("settings.voices.limit");
		if (mode === "edit" && existing === void 0) errors.form = t("settings.voices.noLongerSaved");
		setVoiceErrors(errors);
		if (Object.keys(errors).length !== 0) return;
		const entry = {
			id,
			name,
			note
		};
		const next = mode === "add" ? [...current.savedVoices, entry] : current.savedVoices.map((item) => item.id === id ? entry : item);
		const result = await persistPatch(mode === "add" ? {
			voice: id,
			savedVoices: next
		} : { savedVoices: next }, "voice", (message) => setVoiceErrors({ form: message }));
		if (result === null || !alive.current) return;
		setVoiceEditor(null);
		setVoiceErrors({});
		setVoiceFeedback({ message: `${t(mode === "add" ? "settings.voices.added" : "settings.voices.edited")}${name}` });
		if (mode === "add") {
			setManualVoiceDraft(result.voice);
			setManualVoiceFeedback(null);
			setTestError(null);
		}
	};
	const requestRemoval = (entry) => {
		if (fieldsDisabled) return;
		if (voiceEditor?.mode === "edit" && voiceEditor.id === entry.id) {
			setVoiceErrors((errors) => ({
				...errors,
				form: t("settings.voices.finishEdit")
			}));
			nameInput.current?.focus();
			return;
		}
		setVoiceFeedback(null);
		setManagementFeedback(null);
		setPendingRemoval(entry.id);
	};
	const onRemoveVoice = async () => {
		const current = persisted.current;
		const id = pendingRemoval;
		if (!canWrite() || id === null || current === null) return;
		if (voiceEditor?.mode === "edit" && voiceEditor.id === id) {
			setVoiceErrors((errors) => ({
				...errors,
				form: t("settings.voices.finishEdit")
			}));
			nameInput.current?.focus();
			return;
		}
		const name = current.savedVoices.find((entry) => entry.id === id)?.name;
		if (name === void 0) return;
		if (await persistPatch({ savedVoices: current.savedVoices.filter((entry) => entry.id !== id) }, "remove", (message) => setManagementFeedback({
			message,
			error: true
		})) === null || !alive.current) return;
		setPendingRemoval(null);
		setManagementFeedback({ message: `${t("settings.voices.removed")}${name}` });
	};
	const onTest = async () => {
		if (playing() || testingLock.current) {
			stopTest();
			return;
		}
		const current = persisted.current;
		if (current === null || savingLock.current || manualVoiceDraft.trim() !== current.voice.trim() || current.voice.trim() === "" || !current.keyConfigured) return;
		testingLock.current = true;
		setTesting(true);
		setTestError(null);
		try {
			await test();
		} catch (error) {
			if (alive.current) setTestError(error instanceof Error ? error.message : t("settings.test.failed"));
		} finally {
			testingLock.current = false;
			if (alive.current) setTesting(false);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: "14px",
			maxWidth: "860px",
			minWidth: 0,
			fontSize: "14px",
			lineHeight: 1.6,
			color: "inherit"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "4px",
					minWidth: 0
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
					style: {
						...headingStyle,
						display: "flex",
						alignItems: "center",
						gap: "8px"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { playing: isTestPlaying }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settings.title") })]
				})
			}),
			loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				"aria-live": "polite",
				style: hintStyle,
				children: t("settings.loading")
			}),
			loadError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: actionsStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					role: "alert",
					style: feedbackErrorStyle,
					children: [
						t("settings.loadFailed"),
						": ",
						loadError
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: loading,
					onClick: () => setLoadAttempt((value) => value + 1),
					style: buttonStyle(loading),
					children: t("settings.retry")
				})]
			}),
			savedConfig !== null && !keyConfigured && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "status",
				style: {
					...actionsStyle,
					padding: "10px 12px",
					borderRadius: "6px",
					border: "1px solid rgba(217, 119, 6, 0.45)",
					background: "rgba(217, 119, 6, 0.12)"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: {
						...hintStyle,
						flex: "1 1 240px",
						color: "inherit"
					},
					children: t("settings.connection.firstStep")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => openConnection(true),
					style: buttonStyle(false, "primary"),
					children: t("settings.connection.configure")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"aria-labelledby": `${ids}-voice-title`,
				style: {
					...cardStyle,
					...stackStyle
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: `${ids}-voice-title`,
						style: headingStyle,
						children: t("settings.voices.section")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: fieldStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								htmlFor: `${ids}-manual-id`,
								children: t("settings.voice")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: actionsStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: `${ids}-manual-id`,
									value: manualVoiceDraft,
									maxLength: 256,
									disabled: fieldsDisabled,
									onChange: (event) => {
										setManualVoiceDraft(event.target.value);
										setManualVoiceFeedback(null);
										setTestError(null);
									},
									placeholder: t("settings.voice.placeholder"),
									style: {
										...monoInputStyle,
										flex: "1 1 240px",
										width: "auto"
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: fieldsDisabled || !manualVoiceDirty,
									onClick: () => {
										onApplyManualVoice();
									},
									style: buttonStyle(fieldsDisabled || !manualVoiceDirty, "primary"),
									children: t(savingAction === "manualVoice" ? "settings.saving" : manualVoiceDraft.trim() === "" ? "settings.voice.clear" : "settings.voice.apply")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FeedbackMessage, { feedback: manualVoiceFeedback })
						]
					}),
					currentVoice !== void 0 && currentVoice.name.trim() !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...stackStyle,
							gap: "6px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: {
									margin: 0,
									fontSize: "16px",
									fontWeight: 500,
									overflowWrap: "anywhere"
								},
								children: [t("settings.voices.current"), currentVoice.name]
							}),
							currentVoice.note && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: 0,
									whiteSpace: "pre-wrap",
									overflowWrap: "anywhere"
								},
								children: currentVoice.note
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: fieldsDisabled,
								onClick: () => openEditVoice(currentVoice),
								style: {
									...buttonStyle(fieldsDisabled),
									alignSelf: "flex-start"
								},
								children: t("settings.voices.editCurrent")
							})
						]
					}),
					savedVoices.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: fieldStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: `${ids}-switch`,
							children: t("settings.voices")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							id: `${ids}-switch`,
							value: currentVoice?.id ?? "",
							disabled: fieldsDisabled,
							onChange: (event) => {
								onSelectVoice(event.target.value);
							},
							style: inputStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								disabled: true,
								children: t("settings.voices.choose")
							}), savedVoices.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: entry.id,
								children: entry.name
							}, entry.id))]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: actionsStyle,
						children: [(activeVoice !== "" || canStopTest) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: testDisabled,
							onClick: () => {
								onTest();
							},
							style: buttonStyle(testDisabled, keyConfigured || canStopTest),
							children: t(canStopTest ? "settings.test.stop" : "settings.test")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: fieldsDisabled,
							onClick: () => openAddVoice(currentVoice === void 0 ? activeVoice : ""),
							style: buttonStyle(fieldsDisabled),
							children: t(activeVoice !== "" && currentVoice === void 0 ? "settings.voices.nameCurrent" : "settings.voices.add")
						})]
					}),
					manualVoiceDirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						style: {
							margin: 0,
							overflowWrap: "anywhere"
						},
						children: t("settings.voice.unapplied")
					}),
					testing && !isTestPlaying && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						"aria-live": "polite",
						style: hintStyle,
						children: t("settings.test.playing")
					}),
					connectionDirty && activeVoice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: actionsStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								...hintStyle,
								flex: "1 1 200px"
							},
							children: t("settings.test.savedConnection")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => openConnection(false),
							style: buttonStyle(false),
							children: t("settings.connection.review")
						})]
					}),
					testError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						style: feedbackErrorStyle,
						children: [
							t("settings.test.failed"),
							": ",
							testError
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FeedbackMessage, { feedback: voiceFeedback }),
					voiceEditor !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						noValidate: true,
						"aria-labelledby": `${ids}-editor-title`,
						onSubmit: (event) => {
							event.preventDefault();
							onSaveVoice();
						},
						style: {
							...stackStyle,
							gap: "10px",
							marginTop: "4px",
							padding: "12px",
							borderRadius: "8px",
							border: `1px solid ${colors.border}`,
							background: "transparent"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
								id: `${ids}-editor-title`,
								style: headingStyle,
								children: t(voiceEditor.mode === "add" ? "settings.voices.add" : "settings.voices.editCurrent")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${ids}-name`,
										children: t("settings.voices.name")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `${ids}-name`,
										ref: nameInput,
										autoFocus: true,
										value: voiceEditor.name,
										required: true,
										"aria-required": "true",
										"aria-invalid": !!voiceErrors.name,
										"aria-describedby": voiceErrors.name ? `${ids}-name-error` : void 0,
										maxLength: 80,
										disabled: fieldsDisabled,
										onChange: (event) => updateVoiceEditor("name", event.target.value),
										placeholder: t("settings.voices.name.placeholder"),
										style: inputStyle
									}),
									voiceErrors.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										id: `${ids}-name-error`,
										role: "alert",
										style: errorStyle,
										children: voiceErrors.name
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${ids}-id`,
										children: t("settings.voice.required")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `${ids}-id`,
										value: voiceEditor.id,
										required: true,
										"aria-required": "true",
										"aria-invalid": !!voiceErrors.id || duplicateVoice !== void 0,
										"aria-describedby": `${ids}-id-hint${voiceErrors.id || duplicateVoice ? ` ${ids}-id-error` : ""}`,
										readOnly: voiceEditor.mode === "edit",
										maxLength: 256,
										disabled: fieldsDisabled,
										onChange: (event) => updateVoiceEditor("id", event.target.value),
										placeholder: t("settings.voice.placeholder"),
										style: monoInputStyle
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										id: `${ids}-id-hint`,
										style: hintStyle,
										children: t(voiceEditor.mode === "edit" ? "settings.voices.idReadOnly" : "settings.voice.hint")
									}),
									(voiceErrors.id || duplicateVoice) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										id: `${ids}-id-error`,
										role: "alert",
										style: errorStyle,
										children: voiceErrors.id ?? t("settings.voices.duplicate")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${ids}-note`,
										children: t("settings.voices.note")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										id: `${ids}-note`,
										value: voiceEditor.note,
										maxLength: 500,
										rows: 3,
										disabled: fieldsDisabled,
										"aria-invalid": !!voiceErrors.note,
										"aria-describedby": voiceErrors.note ? `${ids}-note-error` : void 0,
										onChange: (event) => updateVoiceEditor("note", event.target.value),
										placeholder: t("settings.voices.note.placeholder"),
										style: {
											...inputStyle,
											resize: "vertical"
										}
									}),
									voiceErrors.note && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										id: `${ids}-note-error`,
										role: "alert",
										style: errorStyle,
										children: voiceErrors.note
									})
								]
							}),
							voiceErrors.form && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								style: errorStyle,
								children: voiceErrors.form
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: actionsStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									disabled: fieldsDisabled,
									style: buttonStyle(fieldsDisabled, "primary"),
									children: t(savingAction === "voice" ? "settings.saving" : voiceEditor.mode === "add" ? "settings.voices.save" : "settings.voices.saveEdit")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: savingAction === "voice",
									onClick: cancelVoiceEditor,
									style: buttonStyle(savingAction === "voice"),
									children: t("settings.cancel")
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						style: {
							borderTop: `1px solid ${colors.divider}`,
							paddingTop: "10px",
							minWidth: 0
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
							style: {
								cursor: "pointer",
								fontWeight: 500
							},
							children: [t("settings.voices.manage"), savedVoices.length > 0 ? ` (${savedVoices.length})` : ""]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...stackStyle,
								marginTop: "10px"
							},
							children: [
								savedVoices.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: hintStyle,
									children: t("settings.voices.listEmpty")
								}),
								savedVoices.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...stackStyle,
										gap: "8px",
										padding: "10px 0",
										borderBottom: `1px solid ${colors.divider}`
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											...actionsStyle,
											justifyContent: "space-between"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												minWidth: 0,
												flex: "1 1 200px"
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												style: {
													margin: 0,
													fontWeight: 500,
													overflowWrap: "anywhere"
												},
												children: [entry.name, entry.id === activeVoice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														...hintStyle,
														marginLeft: "8px"
													},
													children: t("settings.voices.inUse")
												})]
											}), entry.note && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												title: entry.note,
												style: {
													margin: 0,
													whiteSpace: "pre-line",
													overflowWrap: "anywhere",
													display: "-webkit-box",
													WebkitLineClamp: 2,
													WebkitBoxOrient: "vertical",
													overflow: "hidden"
												},
												children: entry.note
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: actionsStyle,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: fieldsDisabled || entry.id === activeVoice && !manualVoiceDirty,
													"aria-label": `${t("settings.voices.use")} ${entry.name}`,
													onClick: () => {
														onSelectVoice(entry.id);
													},
													style: buttonStyle(fieldsDisabled || entry.id === activeVoice && !manualVoiceDirty),
													children: t("settings.voices.use")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: fieldsDisabled,
													"aria-label": `${t("settings.voices.edit")} ${entry.name}`,
													onClick: () => openEditVoice(entry),
													style: buttonStyle(fieldsDisabled),
													children: t("settings.voices.edit")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: fieldsDisabled,
													"aria-label": `${t("settings.voices.remove")} ${entry.name}`,
													onClick: () => requestRemoval(entry),
													style: buttonStyle(fieldsDisabled),
													children: t("settings.voices.remove")
												})
											]
										})]
									}), pendingRemoval === entry.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											...stackStyle,
											gap: "6px",
											padding: "10px 12px",
											borderRadius: "6px",
											border: "1px solid rgba(220, 38, 38, 0.45)",
											background: "rgba(220, 38, 38, 0.06)"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												style: {
													margin: 0,
													overflowWrap: "anywhere"
												},
												children: [
													t("settings.voices.confirmRemove"),
													" “",
													entry.name,
													"”?"
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												style: hintStyle,
												children: t("settings.voices.removeHint")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: actionsStyle,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: fieldsDisabled,
													onClick: () => {
														onRemoveVoice();
													},
													style: buttonStyle(fieldsDisabled, "danger"),
													children: t("settings.voices.confirm")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: savingAction === "remove",
													onClick: () => setPendingRemoval(null),
													style: buttonStyle(savingAction === "remove"),
													children: t("settings.cancel")
												})]
											})
										]
									})]
								}, entry.id)),
								activeVoice !== "" && currentVoice === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: fieldsDisabled,
									onClick: () => openAddVoice(),
									style: {
										...buttonStyle(fieldsDisabled),
										alignSelf: "flex-start"
									},
									children: t("settings.voices.addOther")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FeedbackMessage, { feedback: managementFeedback })
							]
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"aria-label": t("settings.connection.title"),
				style: {
					...cardStyle,
					...stackStyle
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					ref: connectionDetails,
					open: connectionOpen,
					onToggle: (event) => setConnectionOpen(event.currentTarget.open),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
						style: {
							cursor: "pointer",
							overflowWrap: "anywhere"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: headingStyle,
							children: t("settings.connection.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								...hintStyle,
								marginLeft: "10px"
							},
							children: connectionDirty ? t("settings.connection.unsaved") : savedConfig !== null ? t(keyConfigured ? "settings.status.keyOk" : "settings.status.keyMissing") : ""
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...stackStyle,
							gap: "16px",
							marginTop: "16px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${ids}-key`,
										children: t("settings.apiKey")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `${ids}-key`,
										ref: keyInput,
										type: "password",
										value: connectionDraft.apiKey,
										disabled: fieldsDisabled,
										onChange: (event) => editConnection("apiKey", event.target.value),
										placeholder: keyConfigured ? t("settings.apiKey.placeholder") : t("settings.apiKey.newPlaceholder"),
										autoComplete: "off",
										style: monoInputStyle
									}),
									savedConfig?.hasStoredKey && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: fieldsDisabled,
										onClick: () => {
											onClearKey();
										},
										style: {
											...buttonStyle(fieldsDisabled, "danger"),
											alignSelf: "flex-start"
										},
										children: t("settings.apiKey.clear")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${ids}-model`,
										children: t("settings.model")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `${ids}-model`,
										list: `${ids}-models`,
										value: connectionDraft.model,
										disabled: fieldsDisabled,
										onChange: (event) => editConnection("model", event.target.value),
										placeholder: "s2.1-pro-free",
										style: monoInputStyle
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
										id: `${ids}-models`,
										children: modelOptions.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: id }, id))
									}),
									modelsError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "status",
										style: errorStyle,
										children: t("settings.modelsFailed")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: fieldStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: `${ids}-proxy`,
									children: t("settings.proxy")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: `${ids}-proxy`,
									value: connectionDraft.proxy,
									disabled: fieldsDisabled,
									onChange: (event) => editConnection("proxy", event.target.value),
									placeholder: t("settings.proxy.placeholder"),
									style: monoInputStyle
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: actionsStyle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: fieldsDisabled || !connectionDirty,
									onClick: () => {
										onSaveConnection();
									},
									style: buttonStyle(fieldsDisabled || !connectionDirty, "primary"),
									children: t(savingAction === "connection" ? "settings.saving" : "settings.connection.save")
								})
							})
						]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FeedbackMessage, { feedback: connectionFeedback })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"aria-labelledby": `${ids}-preferences`,
				style: {
					...cardStyle,
					...stackStyle
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...stackStyle,
							gap: "4px"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: `${ids}-preferences`,
							style: headingStyle,
							children: t("settings.preferences.title")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...actionsStyle,
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: `${ids}-autoplay`,
							children: t("settings.autoplay")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: `${ids}-autoplay`,
							type: "checkbox",
							checked: enabled,
							onChange: () => {
								const next = !enabled;
								setEnabled(next);
								setAutoPlay(next);
							},
							style: {
								width: "18px",
								height: "18px",
								accentColor: colors.primary
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...actionsStyle,
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: `${ids}-volume`,
							children: t("settings.volume")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...actionsStyle,
								flex: "0 1 240px",
								flexWrap: "nowrap"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: `${ids}-volume`,
								type: "range",
								min: 0,
								max: 1,
								step: .05,
								value: vol,
								onChange: (event) => {
									const next = Number(event.target.value);
									setVol(next);
									setVolume$1(next);
								},
								style: {
									minWidth: 0,
									width: "180px",
									maxWidth: "100%",
									accentColor: colors.primary
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("output", {
								htmlFor: `${ids}-volume`,
								style: {
									flexShrink: 0,
									minWidth: "38px"
								},
								children: [Math.round(vol * 100), "%"]
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...actionsStyle,
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: `${ids}-speed`,
							children: t("settings.speed")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...actionsStyle,
								flex: "0 1 240px",
								flexWrap: "nowrap"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: `${ids}-speed`,
								type: "range",
								min: .5,
								max: 2,
								step: .25,
								value: speedOk ? spd : 1,
								disabled: !speedOk,
								onChange: (event) => {
									const next = Number(event.target.value);
									setSpd(next);
									setSpeed$1(next);
								},
								style: {
									minWidth: 0,
									width: "180px",
									maxWidth: "100%",
									accentColor: colors.primary
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("output", {
								htmlFor: `${ids}-speed`,
								style: {
									flexShrink: 0,
									minWidth: "38px"
								},
								children: [Number((speedOk ? spd : 1).toFixed(2)), "×"]
							})]
						})]
					}),
					!speedOk && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t("settings.speed.unsupported")
					})
				]
			})
		]
	});
}

//#endregion
//#region src/client/locales.ts
const zh = {
	"action.speak": "朗读",
	"action.speak.aria": "朗读这条回复",
	"action.stop": "停止",
	"action.failed": "语音合成失败",
	"error.voiceRequired": "请先在语音设置中填写并应用音色 ID",
	"input.toggle": "自动朗读新回复",
	"input.toggle.on": "自动朗读已开启，点击关闭",
	"input.toggle.off": "自动朗读已关闭，点击开启",
	"settings.label": "语音朗读 (Fish TTS)",
	"settings.title": "语音合成（Fish Audio）",
	"settings.intro": "选择 AI 回复的声音，随时试听或自动朗读。",
	"settings.saving": "正在保存…",
	"settings.cancel": "取消",
	"settings.loading": "正在加载设置…",
	"settings.loadFailed": "无法加载设置，请重试",
	"settings.modelsFailed": "模型列表暂不可用，仍可手动输入模型 ID。",
	"settings.retry": "重试",
	"settings.model": "TTS 模型（可手动输入）",
	"settings.model.hint": "如 s2.1-pro-free、s2.1-pro、s2-pro，可手动输入",
	"settings.voice": "音色 ID",
	"settings.voice.required": "音色 ID（必填）",
	"settings.voice.hint": "从 Fish Audio 音色页复制 ID。",
	"settings.voice.placeholder": "粘贴 Fish Audio 音色 ID",
	"settings.voice.apply": "应用音色",
	"settings.voice.clear": "清空音色",
	"settings.voice.applied": "音色已应用",
	"settings.voice.cleared": "音色已清空",
	"settings.voice.unapplied": "音色 ID 有未应用的修改，请先应用后试听。",
	"settings.voices": "切换音色",
	"settings.voices.choose": "选择常用音色",
	"settings.voices.unsaved": "当前音色尚未收藏",
	"settings.voices.hint": "选择后立即使用；其余未保存的设置会保留。",
	"settings.voices.name": "音色名称（必填）",
	"settings.voices.name.placeholder": "例如：温柔旁白",
	"settings.voices.note": "音色备注（可选）",
	"settings.voices.note.placeholder": "声音特点或用途，最多 500 字",
	"settings.voices.save": "添加并使用",
	"settings.voices.remove": "移除",
	"settings.voices.idRequired": "请填写音色 ID",
	"settings.voices.nameRequired": "请填写音色名称",
	"settings.voices.tooLong": "音色名称最多 80 字，备注最多 500 字",
	"settings.voices.limit": "最多收藏 100 个音色，请先移除不需要的收藏",
	"settings.voices.section": "音色",
	"settings.voices.current": "正在使用：",
	"settings.voices.unnamed": "尚未命名的音色",
	"settings.voices.showId": "查看音色 ID",
	"settings.voices.editCurrent": "编辑名称和备注",
	"settings.voices.empty": "还没有设置音色",
	"settings.voices.firstHint": "第一次复制音色 ID 并保存名称，以后就能直接切换。",
	"settings.voices.addFirst": "添加第一个音色",
	"settings.voices.nameCurrent": "给当前音色命名",
	"settings.voices.add": "收藏音色",
	"settings.voices.addOther": "添加其他音色",
	"settings.voices.use": "使用",
	"settings.voices.edit": "编辑",
	"settings.voices.saveEdit": "保存修改",
	"settings.voices.added": "已添加并使用：",
	"settings.voices.edited": "已保存音色修改：",
	"settings.voices.switched": "已切换音色：",
	"settings.voices.removed": "已移除收藏：",
	"settings.voices.manage": "管理常用音色",
	"settings.voices.listEmpty": "收藏的音色会显示在这里。",
	"settings.voices.inUse": "正在使用",
	"settings.voices.confirmRemove": "移除这个收藏",
	"settings.voices.removeHint": "只从常用列表移除，正在使用的音色仍然可用。",
	"settings.voices.confirm": "确认移除",
	"settings.voices.duplicate": "这个音色已添加，请编辑已有音色。",
	"settings.voices.idReadOnly": "音色 ID 不变，可选中复制。",
	"settings.voices.idTooLong": "音色 ID 最多 256 个字符",
	"settings.voices.nameTooLong": "音色名称最多 80 个字符",
	"settings.voices.noteTooLong": "音色备注最多 500 个字符",
	"settings.voices.finishEdit": "请先保存或取消当前音色表单，再进行这项操作。",
	"settings.voices.noLongerSaved": "这个收藏已不存在，请取消后重新选择。",
	"settings.connection.title": "连接设置",
	"settings.connection.firstStep": "先保存 API Key，再填写并应用音色 ID 即可试听。",
	"settings.connection.configure": "设置 API Key",
	"settings.connection.save": "保存连接设置",
	"settings.connection.saved": "连接设置已保存",
	"settings.connection.keyClearedEnv": "已清除本机保存的 Key，环境配置的 Key 仍可使用。",
	"settings.connection.keyCleared": "已清除本机保存的 Key",
	"settings.connection.unsaved": "有未保存的修改",
	"settings.connection.review": "查看连接改动",
	"settings.apiKey": "API Key",
	"settings.apiKey.placeholder": "已有 Key，留空保持不变",
	"settings.apiKey.newPlaceholder": "粘贴 Fish Audio API Key",
	"settings.apiKey.clear": "清除已保存的 Key",
	"settings.proxy": "网络代理（可选）",
	"settings.proxy.hint": "如 http://127.0.0.1:7890，留空为直连；不支持带用户名密码的代理地址",
	"settings.proxy.placeholder": "留空直连，或 http://127.0.0.1:7890",
	"settings.save": "保存设置",
	"settings.saved": "已保存，立即生效",
	"settings.saveFailed": "保存失败",
	"settings.status.keyOk": "API Key 已配置",
	"settings.status.keyMissing": "未配置 API Key",
	"settings.autoplay": "新回复自动朗读",
	"settings.autoplay.hint": "仅自动朗读页面打开后产生的新回复，不会重播历史消息。",
	"settings.volume": "音量",
	"settings.speed": "播放速度",
	"settings.speed.unsupported": "当前浏览器不支持倍速播放，已固定为 1×",
	"settings.test": "试听当前音色",
	"settings.test.playing": "正在生成试听语音，可点击停止试听取消…",
	"settings.test.stop": "停止试听",
	"settings.test.failed": "试听失败",
	"settings.test.savedConnection": "当前试听使用已保存的连接设置。",
	"settings.preferences.title": "播放偏好（无须保存）",
	"settings.preferences.hint": "无须保存，应用于后续朗读。",
	"settings.sourceHint": "设置保存在本机 $DSH_HOME/fish-tts/，API Key 使用 AES-256-GCM 加密存储。"
};
const en = {
	"action.speak": "Read aloud",
	"action.speak.aria": "Read this reply aloud",
	"action.stop": "Stop",
	"action.failed": "Speech synthesis failed",
	"error.voiceRequired": "Enter and apply a voice ID in the voice settings first",
	"input.toggle": "Auto-read new replies",
	"input.toggle.on": "Auto-read is on, click to turn off",
	"input.toggle.off": "Auto-read is off, click to turn on",
	"settings.label": "Voice (Fish TTS)",
	"settings.title": "Text-to-speech (Fish Audio)",
	"settings.intro": "Choose a voice for AI replies, preview it, or read replies automatically.",
	"settings.saving": "Saving…",
	"settings.cancel": "Cancel",
	"settings.loading": "Loading settings…",
	"settings.loadFailed": "Unable to load settings; please retry",
	"settings.modelsFailed": "The model list is unavailable. You can still enter a model ID manually.",
	"settings.retry": "Retry",
	"settings.model": "TTS model (you can type an ID)",
	"settings.model.hint": "e.g. s2.1-pro-free, s2.1-pro, s2-pro — free to type any id",
	"settings.voice": "Voice ID",
	"settings.voice.required": "Voice ID (required)",
	"settings.voice.hint": "Copy the ID from the Fish Audio voice page.",
	"settings.voice.placeholder": "Paste a Fish Audio voice ID",
	"settings.voice.apply": "Apply voice",
	"settings.voice.clear": "Clear voice",
	"settings.voice.applied": "Voice applied",
	"settings.voice.cleared": "Voice cleared",
	"settings.voice.unapplied": "The voice ID has unapplied changes. Apply them before previewing.",
	"settings.voices": "Switch voice",
	"settings.voices.choose": "Choose a saved voice",
	"settings.voices.unsaved": "The current voice is not saved",
	"settings.voices.hint": "Selecting a voice applies it immediately and keeps your other unsaved settings.",
	"settings.voices.name": "Voice name (required)",
	"settings.voices.name.placeholder": "For example: Warm narrator",
	"settings.voices.note": "Voice note (optional)",
	"settings.voices.note.placeholder": "Voice qualities or intended use, up to 500 characters",
	"settings.voices.save": "Add and use",
	"settings.voices.remove": "Remove",
	"settings.voices.idRequired": "Enter a voice ID",
	"settings.voices.nameRequired": "Enter a voice name",
	"settings.voices.tooLong": "Voice names allow up to 80 characters and notes up to 500 characters",
	"settings.voices.limit": "You can save up to 100 voices. Remove an unused voice first.",
	"settings.voices.section": "Voice",
	"settings.voices.current": "Using: ",
	"settings.voices.unnamed": "Unnamed voice",
	"settings.voices.showId": "Show voice ID",
	"settings.voices.editCurrent": "Edit name and note",
	"settings.voices.empty": "No voice set up yet",
	"settings.voices.firstHint": "Copy a voice ID and save a name once. After that, switch voices directly.",
	"settings.voices.addFirst": "Add your first voice",
	"settings.voices.nameCurrent": "Name the current voice",
	"settings.voices.add": "Save voice",
	"settings.voices.addOther": "Add another voice",
	"settings.voices.use": "Use",
	"settings.voices.edit": "Edit",
	"settings.voices.saveEdit": "Save changes",
	"settings.voices.added": "Added and now using: ",
	"settings.voices.edited": "Voice changes saved: ",
	"settings.voices.switched": "Voice switched to: ",
	"settings.voices.removed": "Removed saved voice: ",
	"settings.voices.manage": "Manage saved voices",
	"settings.voices.listEmpty": "Saved voices will appear here.",
	"settings.voices.inUse": "In use",
	"settings.voices.confirmRemove": "Remove saved voice",
	"settings.voices.removeHint": "This removes it from the saved list. The current voice remains available.",
	"settings.voices.confirm": "Confirm removal",
	"settings.voices.duplicate": "This voice is already saved. Edit the existing voice instead.",
	"settings.voices.idReadOnly": "The voice ID stays the same. You can select and copy it.",
	"settings.voices.idTooLong": "Voice IDs allow up to 256 characters",
	"settings.voices.nameTooLong": "Voice names allow up to 80 characters",
	"settings.voices.noteTooLong": "Voice notes allow up to 500 characters",
	"settings.voices.finishEdit": "Save or cancel the current voice form before doing this.",
	"settings.voices.noLongerSaved": "This saved voice no longer exists. Cancel and choose a voice again.",
	"settings.connection.title": "Connection settings",
	"settings.connection.firstStep": "Save your API key, then enter and apply a voice ID to preview it.",
	"settings.connection.configure": "Set up API key",
	"settings.connection.save": "Save connection settings",
	"settings.connection.saved": "Connection settings saved",
	"settings.connection.keyClearedEnv": "The locally saved key was cleared. The environment key is still available.",
	"settings.connection.keyCleared": "Locally saved key cleared",
	"settings.connection.unsaved": "Unsaved changes",
	"settings.connection.review": "Review connection changes",
	"settings.apiKey": "API key",
	"settings.apiKey.placeholder": "A key is configured; leave empty to keep it",
	"settings.apiKey.newPlaceholder": "Paste a Fish Audio API key",
	"settings.apiKey.clear": "Clear saved key",
	"settings.proxy": "HTTP proxy (optional)",
	"settings.proxy.hint": "e.g. http://127.0.0.1:7890, empty for direct; proxy URLs with username/password are not supported",
	"settings.proxy.placeholder": "Leave empty for direct, or http://127.0.0.1:7890",
	"settings.save": "Save settings",
	"settings.saved": "Saved, effective immediately",
	"settings.saveFailed": "Save failed",
	"settings.status.keyOk": "API key configured",
	"settings.status.keyMissing": "No API key configured",
	"settings.autoplay": "Read new replies automatically",
	"settings.autoplay.hint": "Only replies that arrive after this page loaded are read automatically; history is never replayed.",
	"settings.volume": "Volume",
	"settings.speed": "Playback speed",
	"settings.speed.unsupported": "This browser does not support pitch-preserving speed control; playback stays at 1×",
	"settings.test": "Preview current voice",
	"settings.test.playing": "Preparing audio… Select Stop preview to cancel.",
	"settings.test.stop": "Stop preview",
	"settings.test.failed": "Test playback failed",
	"settings.test.savedConnection": "This preview uses the saved connection settings.",
	"settings.preferences.title": "Playback preferences (no save needed)",
	"settings.preferences.hint": "No save needed. These apply to subsequent playback.",
	"settings.sourceHint": "Settings live in $DSH_HOME/fish-tts/ on this machine; the API key is encrypted with AES-256-GCM."
};

//#endregion
//#region src/client/preferences.ts
/** Auto-read remains usable for this session when browser storage is denied. */
const KEY = "fish-tts.autoplay";
function createAutoPlayPreference(storage) {
	let enabled = false;
	try {
		enabled = storage().getItem(KEY) === "1";
	} catch {}
	const listeners = /* @__PURE__ */ new Set();
	return {
		enabled: () => enabled,
		set(value) {
			enabled = value;
			try {
				if (value) storage().setItem(KEY, "1");
				else storage().removeItem(KEY);
			} catch {}
			for (const listener of listeners) try {
				listener();
			} catch {}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

//#endregion
//#region src/client/index.tsx
const NS = "fish-tts";
const inject = ["slots", "locale"];
function apply(ctx) {
	const player = new FishTtsPlayer();
	const loadTime = Date.now();
	const played = /* @__PURE__ */ new Set();
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "fish-tts: dictionaries");
	const preference = createAutoPlayPreference(() => window.localStorage);
	const autoPlayEnabled = preference.enabled;
	const setAutoPlay = preference.set;
	const subscribeAutoPlay = preference.subscribe;
	ctx.slots.inject("conversation.input.left", () => {
		return ctx.slots.register({
			name: "conversation.input.left",
			id: NS,
			order: 30,
			locale: NS,
			inject: () => ({
				autoPlayEnabled,
				setAutoPlay,
				subscribeAutoPlay
			})
		}, FishTtsInputToggle);
	});
	const replacements = () => ctx.locale.getLocale().active === "zh" ? REPL_ZH : REPL_EN;
	ctx.slots.inject("conversation.chat.assistant-actions", () => {
		const dispose = ctx.slots.register({
			name: "conversation.chat.assistant-actions",
			id: NS,
			order: 20,
			locale: NS,
			inject: () => ({
				play: (text, owner) => player.play(text, replacements(), owner),
				stop: (owner) => player.stopFor(owner),
				playingFor: (owner) => player.playingFor(owner),
				pendingFor: (owner) => player.pendingFor(owner),
				subscribePlayer: (listener) => player.subscribe(listener),
				autoPlayEnabled,
				loadTime,
				played
			})
		}, FishTtsActions);
		return () => {
			dispose();
			player.stop();
		};
	});
	let disposeSection = null;
	const mountSection = () => {
		if (disposeSection !== null) {
			disposeSection();
			disposeSection = null;
		}
		const t = ctx.locale.bind(NS);
		const sample = ctx.locale.getLocale().active === "zh" ? "你好，这是 Fish Audio 语音朗读测试。模型与音色均已按你的配置就绪。" : "Hello, this is a Fish Audio read-aloud test. The configured model and voice are ready.";
		disposeSection = ctx.slots.register({
			name: "settings.section",
			id: NS,
			order: 50,
			label: () => t("settings.label"),
			inject: () => ({
				t,
				test: () => player.play(sample, replacements(), "fish-tts:test"),
				playing: () => player.playingFor("fish-tts:test"),
				stopTest: () => player.stopFor("fish-tts:test"),
				subscribePlayer: (listener) => player.subscribe(listener),
				autoPlay: autoPlayEnabled,
				setAutoPlay,
				subscribeAutoPlay,
				volume: getVolume,
				setVolume,
				speed: getSpeed,
				setSpeed,
				speedSupported,
				config: () => player.config(),
				saveConfig: (patch) => player.saveConfig(patch),
				models: () => player.models()
			})
		}, FishTtsSettings);
	};
	ctx.slots.inject("settings.section", () => {
		mountSection();
		const onLocale = ctx.on("locale/change", () => {
			mountSection();
		});
		return () => {
			onLocale();
			if (disposeSection !== null) {
				disposeSection();
				disposeSection = null;
			}
		};
	});
	ctx.effect(() => () => {
		player.stop();
	}, "fish-tts: stop audio on unload");
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map
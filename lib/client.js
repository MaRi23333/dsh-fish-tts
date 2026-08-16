window.__ModuleLoader__.load({ id: "dsh-plugin-fish-tts", factory: (require) => {
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
	/** Stop whatever is playing and release its blob URL. */
	stop() {
		if (this.current !== null) {
			this.current.pause();
			this.current = null;
		}
		if (this.currentUrl !== null) {
			URL.revokeObjectURL(this.currentUrl);
			this.currentUrl = null;
		}
	}
	get playing() {
		return this.current !== null && !this.current.paused && !this.current.ended;
	}
	/**
	* Synthesize and play one text.
	* @param text - raw markdown text of the reply (cleaned internally).
	* @param repl - spoken placeholder words for the active locale.
	*/
	async play(text, repl = REPL_EN) {
		const cleaned = cleanForTts(text, repl);
		if (cleaned === "") return;
		const response = await fetch("/fish-tts/synthesize", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: cleaned })
		});
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
		const url = URL.createObjectURL(blob);
		this.stop();
		const audio = new Audio(url);
		audio.volume = getVolume();
		this.current = audio;
		this.currentUrl = url;
		audio.addEventListener("ended", () => {
			if (this.current === audio) {
				this.current = null;
				URL.revokeObjectURL(url);
				if (this.currentUrl === url) this.currentUrl = null;
			}
		});
		try {
			await audio.play();
		} catch (error) {
			if (this.current === audio) {
				this.current = null;
				URL.revokeObjectURL(url);
				if (this.currentUrl === url) this.currentUrl = null;
			}
			throw error;
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
				error: `HTTP ${response.status}`
			};
			return await response.json();
		} catch (error) {
			return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
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
				error: payload.message ?? payload.error ?? `HTTP ${response.status}`
			};
			return payload;
		} catch (error) {
			return {
				ok: false,
				model: "",
				voice: "",
				format: "wav",
				proxy: "",
				keyConfigured: false,
				hasStoredKey: false,
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
	const { messageId, useSession, play, playing, autoPlayEnabled, loadTime, played, t } = props;
	const text = useSession((snapshot) => selectText(snapshot, messageId));
	const isLatest = useSession((snapshot) => selectIsLatest(snapshot, messageId));
	const time = useSession((snapshot) => selectTime(snapshot, messageId));
	const [busy, setBusy] = (0, react.useState)(false);
	const [failure, setFailure] = (0, react.useState)(null);
	const [isPlaying, setIsPlaying] = (0, react.useState)(false);
	const alive = (0, react.useRef)(true);
	(0, react.useEffect)(() => () => {
		alive.current = false;
	}, []);
	(0, react.useEffect)(() => {
		const tick = () => {
			if (alive.current) setIsPlaying(playing());
		};
		tick();
		const timer = window.setInterval(tick, 400);
		return () => {
			window.clearInterval(timer);
		};
	}, [playing]);
	(0, react.useEffect)(() => {
		if (!autoPlayEnabled()) return;
		if (!isLatest || text.trim() === "" || time <= loadTime) return;
		if (played.has(messageId)) return;
		played.add(messageId);
		play(text).catch(() => {
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
		if (busy) return;
		setBusy(true);
		setFailure(null);
		play(text).then(() => {
			if (alive.current) setBusy(false);
		}, (error) => {
			if (!alive.current) return;
			setBusy(false);
			setFailure(error.code === "voice-required" ? t("error.voiceRequired") : t("action.failed"));
		});
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		"aria-label": t("action.speak.aria"),
		"data-active": isPlaying || void 0,
		title: failure ?? t("action.speak"),
		disabled: busy,
		onClick: onSpeak,
		style: {
			background: "none",
			border: "none",
			padding: "0 2px",
			cursor: busy ? "default" : "pointer",
			opacity: busy ? .55 : 1,
			display: "inline-flex",
			alignItems: "center",
			color: failure !== null ? "var(--dsh-color-danger, #e5484d)" : "#7a7a7a"
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { playing: isPlaying })
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
function FishTtsSettings(props) {
	const { t, test, playing, autoPlay, setAutoPlay, subscribeAutoPlay, volume, setVolume: setVolume$1, config, saveConfig, models } = props;
	const [model, setModel] = (0, react.useState)("");
	const [voice, setVoice] = (0, react.useState)("");
	const [apiKey, setApiKey] = (0, react.useState)("");
	const [proxy, setProxy] = (0, react.useState)("");
	const [modelOptions, setModelOptions] = (0, react.useState)([]);
	const [keyStatus, setKeyStatus] = (0, react.useState)("unknown");
	const [saving, setSaving] = (0, react.useState)(false);
	const [savedAt, setSavedAt] = (0, react.useState)(null);
	const [saveError, setSaveError] = (0, react.useState)(null);
	const [enabled, setEnabled] = (0, react.useState)(autoPlay());
	const [vol, setVol] = (0, react.useState)(volume());
	const [testing, setTesting] = (0, react.useState)(false);
	const alive = (0, react.useRef)(true);
	(0, react.useEffect)(() => () => {
		alive.current = false;
	}, []);
	(0, react.useEffect)(() => subscribeAutoPlay(() => {
		setEnabled(autoPlay());
	}), [subscribeAutoPlay, autoPlay]);
	(0, react.useEffect)(() => {
		config().then((result) => {
			if (!alive.current) return;
			setModel(result.model);
			setVoice(result.voice);
			setProxy(result.proxy);
			setKeyStatus(result.keyConfigured ? "ok" : "missing");
		});
		models().then((ids) => {
			if (alive.current) setModelOptions(ids);
		});
	}, [config, models]);
	const onSave = () => {
		if (saving) return;
		setSaving(true);
		setSaveError(null);
		const patch = {
			model,
			voice,
			proxy
		};
		if (apiKey.trim() !== "") patch.apiKey = apiKey.trim();
		saveConfig(patch).then((result) => {
			if (!alive.current) return;
			setSaving(false);
			if (result.ok) {
				setSavedAt(Date.now());
				setApiKey("");
				setModel(result.model);
				setVoice(result.voice);
				setProxy(result.proxy);
				setKeyStatus(result.keyConfigured ? "ok" : "missing");
			} else setSaveError(result.error ?? t("settings.saveFailed"));
		});
	};
	const onClearKey = () => {
		saveConfig({ clearKey: true }).then((result) => {
			if (alive.current && result.ok) setKeyStatus("missing");
		});
	};
	const onTest = () => {
		if (testing) return;
		setTesting(true);
		test().finally(() => {
			if (alive.current) setTesting(false);
		});
	};
	const onToggle = () => {
		const next = !enabled;
		setEnabled(next);
		setAutoPlay(next);
	};
	const rowStyle = {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "12px",
		padding: "8px 0"
	};
	const labelStyle = {
		fontSize: "13px",
		opacity: .85,
		minWidth: "96px"
	};
	const inputStyle = {
		flex: 1,
		fontSize: "13px",
		fontFamily: "monospace",
		padding: "4px 8px",
		border: "1px solid var(--dsh-color-border, #3a3f4b)",
		borderRadius: "4px",
		background: "transparent",
		color: "inherit"
	};
	const hintStyle = {
		fontSize: "11px",
		opacity: .6,
		marginTop: "2px"
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: "8px",
			padding: "12px 4px"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: "15px",
					fontWeight: 600
				},
				children: t("settings.title")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "2px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: labelStyle,
							children: t("settings.model")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							list: "fish-tts-models",
							value: model,
							onChange: (event) => setModel(event.target.value),
							placeholder: "s2.1-pro-free",
							"aria-label": t("settings.model"),
							style: inputStyle
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
						id: "fish-tts-models",
						children: modelOptions.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: id }, id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							...hintStyle,
							marginLeft: "108px"
						},
						children: t("settings.model.hint")
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "2px"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle,
						children: t("settings.voice")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: voice,
						onChange: (event) => setVoice(event.target.value),
						placeholder: t("settings.voice.placeholder"),
						"aria-label": t("settings.voice"),
						style: inputStyle
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						...hintStyle,
						marginLeft: "108px"
					},
					children: t("settings.voice.hint")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "2px"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle,
						children: t("settings.apiKey")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "password",
						value: apiKey,
						onChange: (event) => setApiKey(event.target.value),
						placeholder: keyStatus === "ok" ? t("settings.apiKey.placeholder") : "",
						autoComplete: "off",
						"aria-label": t("settings.apiKey"),
						style: inputStyle
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						gap: "12px",
						marginLeft: "108px",
						alignItems: "center"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "12px",
							color: keyStatus === "ok" ? "var(--dsh-color-success, #30a46c)" : keyStatus === "missing" ? "var(--dsh-color-danger, #e5484d)" : void 0
						},
						children: keyStatus === "ok" ? t("settings.status.keyOk") : keyStatus === "missing" ? t("settings.status.keyMissing") : ""
					}), keyStatus === "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onClearKey,
						style: {
							background: "none",
							border: "none",
							padding: 0,
							fontSize: "12px",
							cursor: "pointer",
							textDecoration: "underline",
							opacity: .7
						},
						children: t("settings.apiKey.clear")
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "2px"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: rowStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle,
						children: t("settings.proxy")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: proxy,
						onChange: (event) => setProxy(event.target.value),
						placeholder: "http://127.0.0.1:7890",
						"aria-label": t("settings.proxy"),
						style: inputStyle
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						...hintStyle,
						marginLeft: "108px"
					},
					children: t("settings.proxy.hint")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: "10px",
					alignItems: "center",
					marginLeft: "108px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: saving,
						onClick: onSave,
						style: {
							padding: "4px 14px",
							fontSize: "13px",
							cursor: saving ? "default" : "pointer",
							opacity: saving ? .55 : 1
						},
						children: t("settings.save")
					}),
					savedAt !== null && saveError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "12px",
							color: "var(--dsh-color-success, #30a46c)"
						},
						children: t("settings.saved")
					}),
					saveError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "12px",
							color: "var(--dsh-color-danger, #e5484d)"
						},
						children: saveError
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "2px"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: labelStyle,
						children: t("settings.autoplay")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "11px",
							opacity: .6
						},
						children: t("settings.autoplay.hint")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked: enabled,
					onChange: onToggle,
					"aria-label": t("settings.autoplay")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: labelStyle,
					children: t("settings.volume")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min: 0,
						max: 1,
						step: .05,
						value: vol,
						"aria-label": t("settings.volume"),
						onChange: (event) => {
							const next = Number(event.target.value);
							setVol(next);
							setVolume$1(next);
						},
						style: { width: "140px" }
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							fontSize: "12px",
							opacity: .75,
							minWidth: "34px"
						},
						children: [Math.round(vol * 100), "%"]
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...rowStyle,
					justifyContent: "flex-start"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: testing || keyStatus !== "ok" || voice.trim() === "",
					onClick: onTest,
					style: {
						padding: "4px 14px",
						fontSize: "13px",
						cursor: testing || keyStatus !== "ok" || voice.trim() === "" ? "default" : "pointer",
						opacity: testing || keyStatus !== "ok" || voice.trim() === "" ? .55 : 1
					},
					children: testing || playing() ? t("settings.test.playing") : t("settings.test")
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: "11px",
					opacity: .55,
					paddingTop: "4px"
				},
				children: t("settings.sourceHint")
			})
		]
	});
}

//#endregion
//#region src/client/locales.ts
const zh = {
	"action.speak": "朗读",
	"action.speak.aria": "朗读这条回复",
	"action.playing": "播放中…",
	"action.failed": "语音合成失败",
	"error.voiceRequired": "请先在设置页填写音色 ID",
	"input.toggle": "自动朗读新回复",
	"input.toggle.on": "自动朗读已开启，点击关闭",
	"input.toggle.off": "自动朗读已关闭，点击开启",
	"settings.label": "语音朗读 (Fish TTS)",
	"settings.title": "Fish Audio 语音朗读",
	"settings.model": "TTS 模型",
	"settings.model.hint": "如 s2.1-pro-free、s2.1-pro、s2-pro，可手动输入",
	"settings.voice": "音色 reference_id（必填）",
	"settings.voice.hint": "你自己的 Fish Audio 音色 ID；未填写时无法合成语音",
	"settings.voice.placeholder": "32 位十六进制音色 ID",
	"settings.apiKey": "API Key",
	"settings.apiKey.placeholder": "已保存（留空保持不变）",
	"settings.apiKey.clear": "清除已保存的 Key",
	"settings.proxy": "网络代理",
	"settings.proxy.hint": "如 http://127.0.0.1:7890，留空为直连；不支持带用户名密码的代理地址",
	"settings.save": "保存设置",
	"settings.saved": "已保存，立即生效",
	"settings.saveFailed": "保存失败",
	"settings.status.keyOk": "API Key 已配置",
	"settings.status.keyMissing": "未配置 API Key（在下方输入并保存）",
	"settings.autoplay": "新回复自动朗读",
	"settings.autoplay.hint": "仅自动朗读页面打开后产生的新回复，不会重播历史消息。",
	"settings.volume": "音量",
	"settings.test": "试听",
	"settings.test.playing": "正在播放测试语音…",
	"settings.sourceHint": "设置保存在本机 $DSH_HOME/fish-tts/，API Key 使用 AES-256-GCM 加密存储。"
};
const en = {
	"action.speak": "Read aloud",
	"action.speak.aria": "Read this reply aloud",
	"action.playing": "Playing…",
	"action.failed": "Speech synthesis failed",
	"error.voiceRequired": "Set a voice reference_id in the settings page first",
	"input.toggle": "Auto-read new replies",
	"input.toggle.on": "Auto-read is on, click to turn off",
	"input.toggle.off": "Auto-read is off, click to turn on",
	"settings.label": "Voice (Fish TTS)",
	"settings.title": "Fish Audio read-aloud",
	"settings.model": "TTS model",
	"settings.model.hint": "e.g. s2.1-pro-free, s2.1-pro, s2-pro — free to type any id",
	"settings.voice": "Voice reference_id (required)",
	"settings.voice.hint": "Your own Fish Audio voice id; synthesis is refused while empty",
	"settings.voice.placeholder": "32-char hex voice id",
	"settings.apiKey": "API key",
	"settings.apiKey.placeholder": "Saved (leave empty to keep)",
	"settings.apiKey.clear": "Clear saved key",
	"settings.proxy": "HTTP proxy",
	"settings.proxy.hint": "e.g. http://127.0.0.1:7890, empty for direct; proxy URLs with username/password are not supported",
	"settings.save": "Save settings",
	"settings.saved": "Saved, effective immediately",
	"settings.saveFailed": "Save failed",
	"settings.status.keyOk": "API key configured",
	"settings.status.keyMissing": "No API key configured (enter and save below)",
	"settings.autoplay": "Read new replies automatically",
	"settings.autoplay.hint": "Only replies that arrive after this page loaded are read automatically; history is never replayed.",
	"settings.volume": "Volume",
	"settings.test": "Test",
	"settings.test.playing": "Playing test audio…",
	"settings.sourceHint": "Settings live in $DSH_HOME/fish-tts/ on this machine; the API key is encrypted with AES-256-GCM."
};

//#endregion
//#region src/client/index.tsx
const NS = "fish-tts";
const STORAGE_KEY = "fish-tts.autoplay";
const inject = ["slots", "locale"];
function apply(ctx) {
	const player = new FishTtsPlayer();
	const loadTime = Date.now();
	const played = /* @__PURE__ */ new Set();
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "fish-tts: dictionaries");
	const autoPlayListeners = /* @__PURE__ */ new Set();
	const autoPlayEnabled = () => {
		try {
			return window.localStorage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	};
	const setAutoPlay = (enabled) => {
		try {
			if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
			else window.localStorage.removeItem(STORAGE_KEY);
		} catch {}
		for (const listener of autoPlayListeners) try {
			listener();
		} catch {}
	};
	const subscribeAutoPlay = (fn) => {
		autoPlayListeners.add(fn);
		return () => {
			autoPlayListeners.delete(fn);
		};
	};
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
				play: (text) => player.play(text, replacements()),
				playing: () => player.playing,
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
				test: () => player.play(sample, replacements()),
				playing: () => player.playing,
				autoPlay: autoPlayEnabled,
				setAutoPlay,
				subscribeAutoPlay,
				volume: getVolume,
				setVolume,
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
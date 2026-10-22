import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import s from "@deepseek-ai/schemastery";
import { ProxyAgent, fetch } from "undici";

//#region src/voices.ts
const MAX_VOICES = 100;
const MAX_ID_CHARS = 256;
const MAX_NAME_CHARS = 80;
const MAX_NOTE_CHARS = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/**
* Validate the complete list before it is persisted or exposed. Only the
* public fields are copied; callers receive a fresh list with fresh entries.
* A missing note is supported for API clients and older local bookmarks.
*/
function normalizeSavedVoices(value) {
	if (!Array.isArray(value) || value.length > MAX_VOICES) return null;
	const result = [];
	const ids = /* @__PURE__ */ new Set();
	for (const entry of value) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
		const { id, name: name$1, note = "" } = entry;
		if (typeof id !== "string" || typeof name$1 !== "string" || typeof note !== "string") return null;
		if (id.length > MAX_ID_CHARS || name$1.length > MAX_NAME_CHARS || note.length > MAX_NOTE_CHARS) return null;
		if (CONTROL_CHARACTERS.test(id) || CONTROL_CHARACTERS.test(name$1) || NOTE_CONTROL_CHARACTERS.test(note)) return null;
		const normalizedId = id.trim();
		const normalizedName = name$1.trim();
		if (normalizedId === "" || normalizedName === "" || ids.has(normalizedId)) return null;
		ids.add(normalizedId);
		result.push({
			id: normalizedId,
			name: normalizedName,
			note: note.trim()
		});
	}
	return result;
}

//#endregion
//#region src/speak.ts
/** Tool name as the model sees it; channels whitelist this name. */
const SPEAK_TOOL_NAME = "fish_tts_speak";
/** Formats a voice bubble can use (IM channels accept silk/mp3/wav/ogg; opus is ogg). */
const SPEAK_FORMATS = new Set([
	"mp3",
	"wav",
	"opus"
]);
const DEFAULT_SPEAK_FORMAT = "mp3";
/** Audio content-type per format (opus → ogg container). */
const SPEAK_MIME = {
	mp3: "audio/mpeg",
	wav: "audio/wav",
	opus: "audio/ogg"
};
/** Tool-level timeout: 15 s synthesis budget + 20 s delivery ceiling + slack.
* The harness does not enforce this, so it stays an honest worst-case figure. */
const SPEAK_TIMEOUT_MS = 4e4;
/** Total budget for one tool-path synthesis across all proxy attempts. */
const SPEAK_SYNTH_TIMEOUT_MS = 15e3;
/** Hard ceiling for one delivery attempt; a hung channel must not pin the
* exclusive tool pipeline (the harness does not enforce timeoutMs itself).
* 20 s per the first channel's feedback: slow uploads hit the old 10 s. */
const SPEAK_DELIVER_TIMEOUT_MS = 2e4;
/** Generated voice files older than this are deleted opportunistically. */
const SPEAK_FILE_TTL_MS = 1440 * 60 * 1e3;
/** Reject absurdly large audio before writing it to disk. */
const SPEAK_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_SPEAK_SETTINGS = {
	enabled: true,
	format: DEFAULT_SPEAK_FORMAT,
	maxChars: 300,
	perMinute: 1,
	loudness: true,
	volumeDb: 0
};
const MIN_MAX_CHARS = 50;
const MAX_MAX_CHARS = 1e3;
const MAX_PER_MINUTE = 30;
const MIN_VOLUME_DB = -20;
const MAX_VOLUME_DB = 20;
/**
* Validate one candidate SpeakSettings object read from storage or a PUT
* body. Whole-object: one bad field rejects the object so a partially
* corrupt file can never half-apply. `null` means "not a speak settings
* object"; callers fall back to the defaults.
*/
function normalizeSpeakSettings(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value;
	if (typeof raw.enabled !== "boolean") return null;
	if (typeof raw.format !== "string" || !SPEAK_FORMATS.has(raw.format)) return null;
	if (typeof raw.maxChars !== "number" || !Number.isInteger(raw.maxChars) || raw.maxChars < MIN_MAX_CHARS || raw.maxChars > MAX_MAX_CHARS) return null;
	if (typeof raw.perMinute !== "number" || !Number.isInteger(raw.perMinute) || raw.perMinute < 0 || raw.perMinute > MAX_PER_MINUTE) return null;
	if (typeof raw.loudness !== "boolean") return null;
	if (typeof raw.volumeDb !== "number" || !Number.isFinite(raw.volumeDb) || raw.volumeDb < MIN_VOLUME_DB || raw.volumeDb > MAX_VOLUME_DB) return null;
	return {
		enabled: raw.enabled,
		format: raw.format,
		maxChars: raw.maxChars,
		perMinute: raw.perMinute,
		loudness: raw.loudness,
		volumeDb: raw.volumeDb
	};
}
/**
* Validate a partial speak patch (only the keys present are checked and
* returned). `null` means at least one provided key is invalid; the caller
* must reject the whole save.
*/
function normalizeSpeakPatch(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value;
	const patch = {};
	if (Object.hasOwn(raw, "enabled")) {
		if (typeof raw.enabled !== "boolean") return null;
		patch.enabled = raw.enabled;
	}
	if (Object.hasOwn(raw, "format")) {
		if (typeof raw.format !== "string" || !SPEAK_FORMATS.has(raw.format)) return null;
		patch.format = raw.format;
	}
	if (Object.hasOwn(raw, "maxChars")) {
		if (typeof raw.maxChars !== "number" || !Number.isInteger(raw.maxChars) || raw.maxChars < MIN_MAX_CHARS || raw.maxChars > MAX_MAX_CHARS) return null;
		patch.maxChars = raw.maxChars;
	}
	if (Object.hasOwn(raw, "perMinute")) {
		if (typeof raw.perMinute !== "number" || !Number.isInteger(raw.perMinute) || raw.perMinute < 0 || raw.perMinute > MAX_PER_MINUTE) return null;
		patch.perMinute = raw.perMinute;
	}
	if (Object.hasOwn(raw, "loudness")) {
		if (typeof raw.loudness !== "boolean") return null;
		patch.loudness = raw.loudness;
	}
	if (Object.hasOwn(raw, "volumeDb")) {
		if (typeof raw.volumeDb !== "number" || !Number.isFinite(raw.volumeDb) || raw.volumeDb < MIN_VOLUME_DB || raw.volumeDb > MAX_VOLUME_DB) return null;
		patch.volumeDb = raw.volumeDb;
	}
	return patch;
}
/**
* Fish emotion/sound tags that must pass through to the API verbatim.
* Anything else bracketed is treated as a stray tag and dropped instead of
* being read aloud (the incident class this module exists to prevent).
*/
const SPEECH_TAGS = new Set([
	"angry",
	"sad",
	"embarrassed",
	"emphasis",
	"whispering",
	"soft",
	"breathy",
	"excited",
	"laughing",
	"chuckling",
	"sighing",
	"sobbing",
	"crying loudly",
	"panting",
	"groaning",
	"moaning",
	"clear throat",
	"pause",
	"long pause",
	"crowd laughing",
	"background laughter",
	"audience laughing"
]);
/**
* Clean a model-authored line into speakable text. The square brackets of
* markdown are intentionally NOT in the symbol set — only link/image syntax
* with a real URL scheme is unwrapped, so `[soft]` can never lose its
* brackets here. Parenthesis asides (（尾巴晃来晃去）, "(tail wagging)") are
* stage directions, not speech: they are removed so Fish cannot read them
* aloud. Identifier-style ASCII parentheses such as `f(3)` are left alone.
*/
function cleanSpeechText(input) {
	return input.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:|www\.)[^)\s]*\)/g, (link, label) => SPEECH_TAGS.has(label.trim().toLowerCase()) ? link : label).replace(/\b(?:https?:\/\/|www\.)\S+/g, " ").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ").replace(/（[^（）]*）/g, " ").replace(/(?<![A-Za-z0-9])\([^()\n]*\)/g, " ").replace(/[*_#>|~]+/g, " ").replace(/\s+/g, " ").trim();
}
/**
* Drop bracketed tokens that are not documented Fish tags. A known tag
* (`[soft]`, `[crying loudly]`, case-insensitive) survives verbatim; an
* English-tag-shaped unknown token (letters/digits/spaces — the shape of
* emotion/sound tags) is removed so Fish cannot read the bare word aloud.
* Anything else — CJK references like「[见附录第三节]」, citations like
* `[1]` — is content and is left untouched.
*/
const TAG_LIKE = /^[a-z][a-z0-9 ]{0,31}$/i;
function dropUnknownTags(text) {
	return text.replace(/\[([^[\]]{1,32})\]/g, (token, inner) => {
		const trimmed = inner.trim();
		if (SPEECH_TAGS.has(trimmed.toLowerCase())) return token;
		return TAG_LIKE.test(trimmed) ? " " : token;
	}).replace(/\s+/g, " ").trim();
}
/**
* Per-conversation send slots. The slot is claimed BEFORE synthesis so the
* multi-second synthesis window cannot be raced by a parallel call, and
* released when a failed attempt sent nothing — the cooldown counts from the
* last successful send, not from attempts.
*/
var RateLimiter = class {
	last = /* @__PURE__ */ new Map();
	ops = 0;
	/**
	* Claim the send slot for `key`.
	* @returns `ok: true` with the claim token (pass back to {@link release}),
	*   or `ok: false` with the whole seconds until the slot frees up.
	*/
	tryAcquire(key, intervalMs, now = Date.now()) {
		if (++this.ops % 256 === 0 && this.last.size > 16) {
			for (const [entry, at] of this.last) if (now - at >= intervalMs) this.last.delete(entry);
		}
		const previous = this.last.get(key);
		if (previous !== void 0) {
			const elapsed = now - previous;
			if (elapsed < intervalMs) {
				const cap = Math.max(1, Math.ceil(intervalMs / 1e3));
				return {
					ok: false,
					retryAfterSec: Math.min(cap, Math.max(1, Math.ceil((intervalMs - elapsed) / 1e3)))
				};
			}
		}
		this.last.set(key, now);
		return {
			ok: true,
			token: now
		};
	}
	/** Give the slot back after a failed attempt (nothing was sent). */
	release(key, token) {
		if (this.last.get(key) === token) this.last.delete(key);
	}
};
/** Registry of channel delivery hooks, exposed to channels as `ctx.fishTts`. */
var DeliveryRegistry = class {
	entries = /* @__PURE__ */ new Map();
	/** Register (or replace) a channel's hook; returns the exact disposer. */
	register(channel, delivery) {
		if (typeof channel !== "string" || channel.trim() === "" || delivery === null || typeof delivery !== "object" || typeof delivery.deliver !== "function" || delivery.claims !== void 0 && typeof delivery.claims !== "function") throw new TypeError("invalid speech delivery registration");
		this.entries.set(channel, delivery);
		return () => {
			if (this.entries.get(channel) === delivery) this.entries.delete(channel);
		};
	}
	get size() {
		return this.entries.size;
	}
	/** First registered channel that claims this session, in registration
	* order. A `claims` hook that throws is treated as "not claimed" so one
	* broken channel cannot take the tool call down — keep looking. */
	find(sessionId, agent) {
		for (const [channel, delivery] of this.entries) {
			let claimed = true;
			if (delivery.claims !== void 0) try {
				claimed = delivery.claims(sessionId, agent) === true;
			} catch {
				claimed = false;
			}
			if (claimed) return {
				channel,
				delivery
			};
		}
	}
};
/** Resolve the `voice` argument: saved-voice id or name first, then a raw
* Fish reference_id. `null` = nothing usable (no default configured). */
function resolveSpeakVoice(requested, savedVoices, defaultVoice) {
	if (typeof requested === "string" && requested.trim() !== "") {
		const wanted = requested.trim();
		const saved = savedVoices.find((entry) => entry.id === wanted) ?? savedVoices.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase());
		if (saved !== void 0) return {
			voice: saved.id,
			from: "saved"
		};
		return {
			voice: wanted,
			from: "raw"
		};
	}
	const fallback = defaultVoice.trim();
	return fallback === "" ? null : {
		voice: fallback,
		from: "default"
	};
}
/** Error codes are prefixed into the message so the model can branch on them
* (the requirement's model-readable error table) without extra plumbing. */
function speakError(code, message) {
	return /* @__PURE__ */ new Error(`${SPEAK_TOOL_NAME}(${code}): ${message}`);
}
/**
* Redact credential-bearing fragments, local paths, and bound the length of
* upstream error text before it reaches the model context or logs: a hostile
* proxy error page must not be able to echo the API key, and channel
* exception text must not carry the out-dir path or identity data verbatim.
*/
function sanitizeErrorDetail(text, max = 200) {
	return text.replace(/bearer\s+\S+/gi, "[redacted]").replace(/authorization"?\s*[:=]\s*"?[^,";\s]+/gi, "[redacted]").replace(/[A-Za-z]:\\[^\s"'`,;)]*/g, "[path]").replace(/(?:\/(?:home|Users|root)\/)\S*/g, "[path]").slice(0, max);
}
/** Map a host synthesis failure onto the contract's error codes. */
function speakSynthesisErrorCode(error, aborted = false) {
	if (aborted) return "cancelled";
	const name$1 = error?.name;
	if (name$1 === "TimeoutError" || name$1 === "AbortError") return "timeout";
	const message = error?.message;
	if (typeof message === "string" && /\babort|timed? ?out\b/i.test(message)) return "timeout";
	const status = error?.status;
	if (typeof status !== "number") return "network";
	if (status === 401 || status === 403) return "auth";
	if (status === 402 || status === 429) return "quota";
	if (status === 0) return "network";
	return "failed";
}
/** Best-effort delete of expired speak files; never throws. */
function cleanupSpeakFiles(dir, ttlMs, now = Date.now()) {
	try {
		for (const name$1 of readdirSync(dir)) {
			if (!name$1.startsWith("speak-") || !name$1.includes(".")) continue;
			const file = join(dir, name$1);
			try {
				if (now - statSync(file).mtimeMs > ttlMs) rmSync(file, { force: true });
			} catch {}
		}
	} catch {}
}
/** Short user-visible render line: no spoken content, no "voice sent" narration. */
function renderSpeakResult(value) {
	const v = value;
	const delivered = v.delivered ? ` · delivered${v.channel !== void 0 ? ` (${v.channel})` : ""}` : " · not delivered";
	return [{
		type: "text",
		text: `${SPEAK_TOOL_NAME}: ${v.chars} chars · ${v.format}${delivered}`
	}];
}
/** Thrown by the delivery race when the channel hook exceeds its ceiling.
* Distinguishes "delivery may still complete channel-side" (keep the file)
* from a clean channel rejection (delete the file). */
var DeliveryTimeoutError = class extends Error {
	constructor(ceilingMs) {
		super(`delivery timed out after ${Math.round(ceilingMs / 1e3)}s`);
		this.name = "DeliveryTimeoutError";
	}
};
/** Build the model-facing tool definition. Registration and lifecycle are the
* host's job (see apply in index.ts); this factory only closes over deps.
* The description states usage and mechanics ONLY — usage policy (when to
* call, style, length, language) belongs to the calling agent's persona,
* not to this tool. */
function createSpeakTool(deps) {
	return {
		name: SPEAK_TOOL_NAME,
		description: [
			"Generate an audio file from a short line of text (Fish Audio TTS); when the current session has a chat channel attached, the file is handed to that channel for delivery, otherwise it is only saved locally.",
			"The text is spoken as-is: pass the utterance itself, not a chat message.",
			"Allowed English half-width bracket tags:",
			"emotion [angry] [sad] [embarrassed] [emphasis] [whispering] [soft] [breathy] [excited];",
			"sound [laughing] [chuckling] [sighing] [sobbing] [crying loudly] [panting] [groaning] [moaning] [clear throat] [pause] [long pause] [crowd laughing] [background laughter] [audience laughing].",
			"Known tags pass through verbatim; unknown tags, markdown, emoji, links and code are stripped before synthesis.",
			"Rate limit: a few voices per minute per conversation; when the limit is hit, the call fails with the remaining seconds."
		].join(" "),
		timeoutMs: SPEAK_TIMEOUT_MS,
		parameters: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "The words to speak. Fish bracket tags pass through verbatim; parenthetical stage directions, markdown, code and links are removed before synthesis."
				},
				voice: {
					type: "string",
					description: "Optional saved-voice name or id, or a raw Fish Audio reference_id. Omit to use the default voice."
				},
				format: {
					type: "string",
					enum: [
						"mp3",
						"wav",
						"opus"
					],
					description: "Optional audio format. Omit to use the configured default (mp3)."
				}
			},
			required: ["text"],
			additionalProperties: false
		},
		output: {
			schema: {
				type: "object",
				properties: {
					bytes: { type: "integer" },
					chars: { type: "integer" },
					format: { type: "string" },
					mime: { type: "string" },
					delivered: { type: "boolean" },
					channel: { type: "string" },
					fileName: { type: "string" },
					voice: { type: "string" }
				},
				required: [
					"bytes",
					"chars",
					"format",
					"mime",
					"delivered"
				],
				additionalProperties: false
			},
			render: (_args, value) => renderSpeakResult(value)
		},
		async execute(args, exec = {}) {
			const now = deps.now ?? Date.now;
			const cfg = deps.settings();
			if (!cfg.enabled) throw speakError("disabled", "the speech tool is turned off in the Fish TTS settings");
			if (cfg.perMinute <= 0) throw speakError("rate-limited", "voice sending is disabled (per-minute limit is 0) — reply with text instead");
			if (!deps.hasApiKey()) throw speakError("auth", "no Fish Audio API key is configured — set it in the Fish TTS plugin settings");
			const raw = args?.text;
			if (typeof raw !== "string" || raw.trim() === "") throw speakError("failed", "`text` must be a non-empty string");
			const text = dropUnknownTags(cleanSpeechText(raw));
			if (text === "") throw speakError("text-empty", "the text has no speakable content (only code, links or symbols)");
			if (text.length > cfg.maxChars) throw speakError("text-too-long", `the line is ${text.length} chars, over the ${cfg.maxChars}-char limit — shorten it or reply with text`);
			const voice = resolveSpeakVoice(args.voice, deps.savedVoices(), deps.defaultVoice());
			if (voice === null) throw speakError("voice-not-configured", "no default voice is configured — set one in the Fish TTS plugin settings");
			const requestedFormat = args.format;
			const format = typeof requestedFormat === "string" && SPEAK_FORMATS.has(requestedFormat) ? requestedFormat : cfg.format;
			const mime = SPEAK_MIME[format] ?? "audio/mpeg";
			const agent = exec.agent;
			const sessionId = agent?.session?.id;
			const sessionKey = typeof sessionId === "string" && sessionId !== "" ? sessionId : "default";
			const intervalMs = Math.ceil(6e4 / cfg.perMinute);
			const slot = deps.limiter.tryAcquire(sessionKey, intervalMs, now());
			if (!slot.ok) throw speakError("rate-limited", `a voice was sent too recently in this conversation — wait ${slot.retryAfterSec}s or reply with text`);
			let audio;
			try {
				audio = await deps.synthesize({
					text,
					voice: voice.voice,
					model: deps.model(),
					format,
					volumeDb: cfg.volumeDb,
					loudness: cfg.loudness,
					signal: exec.signal
				});
			} catch (error) {
				deps.limiter.release(sessionKey, slot.token);
				throw speakError(speakSynthesisErrorCode(error, exec.signal?.aborted === true), `synthesis failed — ${sanitizeErrorDetail(error instanceof Error ? error.message : String(error))}`);
			}
			if (audio.length > SPEAK_MAX_FILE_BYTES) {
				deps.limiter.release(sessionKey, slot.token);
				throw speakError("failed", `the synthesized clip is ${audio.length} bytes, over the ${SPEAK_MAX_FILE_BYTES}-byte cap — shorten the line`);
			}
			if (exec.signal?.aborted === true) {
				deps.limiter.release(sessionKey, slot.token);
				throw speakError("cancelled", "the turn was cancelled before delivery");
			}
			const outDir = deps.outDir();
			const fileName = `speak-${now().toString(36)}-${randomUUID().slice(0, 8)}.${format}`;
			const audioPath = join(outDir, fileName);
			try {
				mkdirSync(outDir, { recursive: true });
				writeFileSync(audioPath, audio);
			} catch (error) {
				deps.limiter.release(sessionKey, slot.token);
				throw speakError("failed", `could not write the audio file — ${sanitizeErrorDetail(error instanceof Error ? error.message : String(error))}`);
			}
			const claimed = deps.deliveries.find(sessionKey, agent);
			if (claimed !== void 0) try {
				const deliverCeiling = deps.deliverTimeoutMs ?? SPEAK_DELIVER_TIMEOUT_MS;
				await Promise.race([claimed.delivery.deliver({
					audioPath,
					mime,
					text,
					sessionId: sessionKey,
					agent,
					signal: exec.signal
				}), new Promise((_, reject) => {
					setTimeout(() => reject(new DeliveryTimeoutError(deliverCeiling)), deliverCeiling).unref?.();
				})]);
				try {
					rmSync(audioPath, { force: true });
				} catch {}
			} catch (error) {
				if (!(error instanceof DeliveryTimeoutError)) try {
					rmSync(audioPath, { force: true });
				} catch {}
				deps.limiter.release(sessionKey, slot.token);
				throw speakError("voice-rejected", `the channel rejected the voice — ${sanitizeErrorDetail(error instanceof Error ? error.message : String(error))}`);
			}
			cleanupSpeakFiles(outDir, SPEAK_FILE_TTL_MS, now());
			deps.log(`${SPEAK_TOOL_NAME} ${audio.length}B ${text.length}ch ${format} delivered=${claimed !== void 0}`);
			return {
				bytes: audio.length,
				chars: text.length,
				format,
				mime,
				delivered: claimed !== void 0,
				...claimed !== void 0 ? { channel: claimed.channel } : { fileName },
				...voice.from === "default" ? {} : { voice: voice.voice }
			};
		}
	};
}

//#endregion
//#region src/index.ts
const name = "fish-tts";
const Config = s.object({
	model: s.string().default(""),
	voice: s.string().default(""),
	format: s.string().default("wav"),
	apiKey: s.string().default(""),
	apiKeyFile: s.string().default(""),
	proxy: s.string().default(""),
	stateDir: s.string().default("")
});
const API_URL = "https://api.fish.audio/v1/tts";
const MODELS_URL = "https://api.fish.audio/v1/models";
const MAX_TEXT_CHARS = 12e3;
const MAX_BODY_BYTES = 1 << 18;
const CACHE_LIMIT = 200;
const FORMATS = new Set([
	"wav",
	"mp3",
	"opus",
	"pcm"
]);
const SETTINGS_VERSION = 1;
/** Public model fallback; voices are personal and must be set by the user. */
const MODEL_DEFAULT = "s2.1-pro-free";
/** Curated fallback when the live model list cannot be fetched. */
const FALLBACK_MODELS = [
	"s2.1-pro-free",
	"s2.1-pro",
	"s2-pro"
];
/** Read a KEY=value line from a dotenv-style file. */
function readDotenvKey(path, key) {
	try {
		for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
		}
	} catch {}
	return "";
}
/** Resolve a Fish API key from the ambient environment (never the store). */
function resolveEnvKey(config) {
	const fromConfig = (config.apiKey ?? "").trim();
	if (fromConfig !== "") return fromConfig;
	const fromEnv = (process.env.FISH_API_KEY ?? "").trim();
	if (fromEnv !== "") return fromEnv;
	const file = (config.apiKeyFile ?? "").trim();
	if (file !== "") {
		const key = readDotenvKey(file, "FISH_API_KEY");
		if (key !== "") return key;
	}
	return "";
}
/** Is a TCP port accepting connections on localhost? */
function portOpen(port, timeoutMs = 400) {
	return new Promise((resolve) => {
		const socket = connect({
			host: "127.0.0.1",
			port,
			timeout: timeoutMs
		});
		const done = (value) => {
			socket.destroy();
			resolve(value);
		};
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.once("timeout", () => done(false));
	});
}
/**
* Normalize a user-configured proxy URL; http/https only.
*
* URLs carrying userinfo (username/password) are rejected outright: the
* saved proxy is echoed by GET /status and GET /config, so credentials in
* the proxy URL would leak into browser-readable JSON responses (FISH-SEC-001).
*/
function proxyOf(url) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		if (parsed.username !== "" || parsed.password !== "") return null;
		return parsed.href.replace(/\/$/, "");
	} catch {
		return null;
	}
}
/**
* Redact any userinfo from a proxy URL before it reaches a response.
* Malformed URLs fail closed (return '') so a broken-but-credentialed
* patch-config value can never be echoed verbatim.
*/
function redactProxy(url) {
	try {
		const parsed = new URL(url);
		if (parsed.username !== "" || parsed.password !== "") {
			parsed.username = "";
			parsed.password = "";
			return parsed.href.replace(/\/$/, "");
		}
		return url;
	} catch {
		return "";
	}
}
/** Thrown when a settings patch must not be persisted. */
var SettingsError = class extends Error {
	constructor(message, code = "invalid-proxy") {
		super(message);
		this.code = code;
		this.name = "SettingsError";
	}
};
/** Validate a proxy value before persisting; throws SettingsError with a
* user-readable message when the value must not be saved. */
function validateProxyForSave(value) {
	const trimmed = value.trim();
	if (trimmed === "") return "";
	const normalized = proxyOf(trimmed);
	if (normalized === null) throw new SettingsError("proxy must be an http:// or https:// URL without username/password");
	return normalized;
}
/**
* Sanitize a seed proxy (bundle-patch default) before it can be persisted:
* illegal schemes and credential-bearing URLs are dropped entirely — never
* written to settings.json, never echoed in responses, logs or errors
* (FISH-SEC-003). Unlike the PUT path this does not throw: a bad seed must
* not crash plugin startup, it is simply ignored.
*/
function sanitizeSeedProxy(value) {
	if (value === void 0) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	try {
		return validateProxyForSave(trimmed);
	} catch {
		return;
	}
}
/** Proxy port (default per scheme) for the localhost reachability probe. */
function proxyPortOf(proxyUrl) {
	try {
		const parsed = new URL(proxyUrl);
		if (parsed.port !== "") return Number(parsed.port);
		return parsed.protocol === "https:" ? 443 : 80;
	} catch {
		return null;
	}
}
/** Best-effort Windows ACL tightening: current user only, inheritance removed. */
function tightenAcl(filePath) {
	if (process.platform !== "win32") return;
	const user = process.env.USERNAME;
	if (user === void 0) return;
	try {
		spawnSync("icacls", [
			filePath,
			"/inheritance:r",
			"/grant:r",
			`${user}:F`
		], {
			stdio: "ignore",
			timeout: 5e3
		});
	} catch {}
}
function stateDirOf(config) {
	const configured = (config.stateDir ?? "").trim();
	if (configured !== "") return configured;
	const home = process.env.DSH_HOME?.trim();
	return join(home !== void 0 && home !== "" ? home : join(homedir(), ".dsh"), "fish-tts");
}
function loadOrCreateKey(dir) {
	const path = join(dir, "key.bin");
	try {
		const existing = readFileSync(path);
		if (existing.length === 32) {
			try {
				chmodSync(path, 384);
			} catch {}
			tightenAcl(path);
			return existing;
		}
	} catch {}
	mkdirSync(dir, { recursive: true });
	const key = randomBytes(32);
	try {
		writeFileSync(path, key, {
			flag: "wx",
			mode: 384
		});
		tightenAcl(path);
	} catch {}
	const created = readFileSync(path);
	return created.length === 32 ? created : key;
}
function encrypt(secret, key) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return {
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		data: data.toString("base64")
	};
}
function decrypt(cipherText, key) {
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(cipherText.iv, "base64"));
		decipher.setAuthTag(Buffer.from(cipherText.tag, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(cipherText.data, "base64")), decipher.final()]).toString("utf8");
	} catch {
		return "";
	}
}
var SettingsStore = class {
	filePath;
	key;
	file;
	/** True when settings.json could not be parsed at all (or was not an
	* object) — only then is the file parked as .corrupt-*; a well-formed v0
	* file is migrated in place instead. */
	parseFailed = false;
	/** True when a PRESENT speak block failed validation: the tool fails
	* closed (disabled) instead of silently reviving default limits, and the
	* startup warning tells the user to fix the file. */
	speakCorrupt = false;
	constructor(dir, seed) {
		mkdirSync(dir, { recursive: true });
		this.filePath = join(dir, "settings.json");
		this.key = loadOrCreateKey(dir);
		let hadContent = false;
		try {
			hadContent = existsSync(this.filePath) && readFileSync(this.filePath).length > 0;
		} catch {
			hadContent = false;
		}
		this.file = this.read();
		if (this.file.version === 0 && hadContent && this.parseFailed) try {
			renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
		} catch {}
		if (this.file.version === 0) {
			this.file = {
				version: SETTINGS_VERSION,
				model: this.file.model ?? seed.model,
				voice: this.file.voice ?? seed.voice,
				...this.file.savedVoices !== void 0 ? { savedVoices: this.file.savedVoices } : {},
				format: this.file.format ?? seed.format,
				proxy: sanitizeSeedProxy(this.file.proxy ?? seed.proxy),
				...this.file.apiKeyCipher !== void 0 ? { apiKeyCipher: this.file.apiKeyCipher } : {}
			};
			this.write();
		}
		const cleanedProxy = sanitizeSeedProxy(this.file.proxy);
		if (cleanedProxy !== this.file.proxy) {
			this.file.proxy = cleanedProxy;
			this.write();
		}
	}
	get stateDir() {
		return dirname(this.filePath);
	}
	read() {
		try {
			const raw = readFileSync(this.filePath).toString("utf8").replace(/^\uFEFF/, "").trim();
			const parsed = JSON.parse(raw);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				this.parseFailed = true;
				return { version: 0 };
			}
			let speak;
			if (parsed.speak !== void 0) {
				speak = normalizeSpeakSettings(parsed.speak) ?? void 0;
				if (speak === void 0) this.speakCorrupt = true;
			}
			return {
				version: typeof parsed.version === "number" ? parsed.version : 0,
				model: typeof parsed.model === "string" ? parsed.model : void 0,
				voice: typeof parsed.voice === "string" ? parsed.voice : void 0,
				savedVoices: parsed.savedVoices === void 0 ? void 0 : normalizeSavedVoices(parsed.savedVoices) ?? [],
				format: typeof parsed.format === "string" ? parsed.format : void 0,
				proxy: typeof parsed.proxy === "string" ? parsed.proxy : void 0,
				speak,
				apiKeyCipher: typeof parsed.apiKeyCipher === "object" && parsed.apiKeyCipher !== null ? parsed.apiKeyCipher : void 0
			};
		} catch {
			this.parseFailed = true;
			return { version: 0 };
		}
	}
	write(file = this.file) {
		const temp = `${this.filePath}.tmp-${process.pid}`;
		writeFileSync(temp, JSON.stringify(file, null, 2), { mode: 384 });
		renameSync(temp, this.filePath);
	}
	/** Effective model/voice/format with the patch config as fallback. */
	effective(config) {
		const storedKey = this.file.apiKeyCipher !== void 0 ? decrypt(this.file.apiKeyCipher, this.key) : "";
		const model = (this.file.model ?? "").trim() || (config.model ?? "").trim() || MODEL_DEFAULT;
		const voice = (this.file.voice ?? config.voice ?? "").trim();
		const rawFormat = (this.file.format ?? "").trim() || (config.format ?? "").trim() || "wav";
		return {
			model,
			voice,
			format: FORMATS.has(rawFormat) ? rawFormat : "wav",
			proxy: sanitizeSeedProxy((this.file.proxy ?? "").trim() || (config.proxy ?? "").trim() || "") ?? "",
			speak: this.file.speak ?? (this.speakCorrupt ? {
				...DEFAULT_SPEAK_SETTINGS,
				enabled: false
			} : DEFAULT_SPEAK_SETTINGS),
			storedKey,
			hasStoredKey: this.file.apiKeyCipher !== void 0
		};
	}
	/** Apply an edit patch; empty strings clear the field, undefined keeps it. */
	update(patch) {
		let nextSavedVoices;
		if (Object.hasOwn(patch, "savedVoices")) {
			const normalized = normalizeSavedVoices(patch.savedVoices);
			if (normalized === null) throw new SettingsError("savedVoices must contain up to 100 unique voices with valid id, name and note", "invalid-saved-voices");
			nextSavedVoices = normalized;
		}
		let nextSpeak;
		if (Object.hasOwn(patch, "speak")) {
			const normalized = normalizeSpeakPatch(patch.speak);
			if (normalized === null) throw new SettingsError("speak must contain enabled (bool), format (mp3|wav|opus), maxChars (50-1000), perMinute (0-30), loudness (bool) and volumeDb (-20..20) when present", "invalid-speak");
			nextSpeak = {
				...this.file.speak ?? DEFAULT_SPEAK_SETTINGS,
				...normalized
			};
		}
		let nextProxy;
		if (patch.proxy !== void 0) nextProxy = patch.proxy.trim() === "" ? "" : validateProxyForSave(patch.proxy);
		const nextFile = { ...this.file };
		if (patch.model !== void 0) nextFile.model = patch.model.trim() === "" ? void 0 : patch.model.trim();
		if (patch.voice !== void 0) nextFile.voice = patch.voice.trim();
		if (nextSavedVoices !== void 0) nextFile.savedVoices = nextSavedVoices;
		if (nextSpeak !== void 0) nextFile.speak = nextSpeak;
		if (patch.format !== void 0) {
			const format = patch.format.trim().toLowerCase();
			nextFile.format = FORMATS.has(format) ? format : void 0;
		}
		if (patch.proxy !== void 0) nextFile.proxy = nextProxy === "" ? void 0 : nextProxy;
		if (patch.clearKey === true) delete nextFile.apiKeyCipher;
		else if (typeof patch.apiKey === "string" && patch.apiKey.trim() !== "") nextFile.apiKeyCipher = encrypt(patch.apiKey.trim(), this.key);
		this.write(nextFile);
		this.file = nextFile;
	}
	/** Public summary: everything except key material, proxy userinfo redacted. */
	summary(config) {
		const eff = this.effective(config);
		return {
			model: eff.model,
			voice: eff.voice,
			savedVoices: normalizeSavedVoices(this.file.savedVoices ?? []) ?? [],
			format: eff.format,
			proxy: redactProxy(eff.proxy),
			speak: eff.speak,
			keyConfigured: eff.storedKey !== "" || resolveEnvKey(config) !== "",
			hasStoredKey: eff.hasStoredKey
		};
	}
	/** The API key to use for synthesis: stored > patch config > env > apiKeyFile. */
	apiKey(config) {
		const eff = this.effective(config);
		return eff.storedKey !== "" ? eff.storedKey : resolveEnvKey(config);
	}
};
/** Bound the size of upstream error bodies before they reach responses/logs. */
function truncate(text, max = 400) {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
var FishTtsError = class extends Error {
	constructor(status, message) {
		super(`Fish TTS failed (${status === 0 ? "network" : status}): ${truncate(message)}`);
		this.status = status;
		this.name = "FishTtsError";
	}
};
/** POST the synthesis request; returns audio bytes. */
async function synthesize(text, voice, model, format, apiKey, proxies, agents, opts = {}) {
	const payload = JSON.stringify({
		text,
		reference_id: voice === "" ? null : voice,
		format,
		normalize: true,
		latency: "balanced",
		...opts.prosody !== void 0 ? { prosody: opts.prosody } : {}
	});
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		model
	};
	const attempts = [...proxies, null];
	let lastError = {
		status: 0,
		message: "unknown error"
	};
	const budget = opts.timeoutMs !== void 0 ? AbortSignal.timeout(opts.timeoutMs) : void 0;
	const shared = opts.signal !== void 0 && budget !== void 0 ? AbortSignal.any([opts.signal, budget]) : opts.signal ?? budget;
	for (const proxy of attempts) try {
		const signal = shared ?? AbortSignal.timeout(6e4);
		const response = proxy === null ? await fetch(API_URL, {
			method: "POST",
			headers,
			body: payload,
			signal
		}) : await fetch(API_URL, {
			method: "POST",
			headers,
			body: payload,
			dispatcher: agents.get(proxy),
			signal
		});
		if (!response.ok) {
			const message = truncate(await response.text().catch(() => ""));
			lastError = {
				status: response.status,
				message
			};
			if (response.status >= 400 && response.status < 500) throw new FishTtsError(response.status, message);
			continue;
		}
		const body = Buffer.from(await response.arrayBuffer());
		if (body.length < 64) {
			lastError = {
				status: 0,
				message: "empty audio response"
			};
			continue;
		}
		return body;
	} catch (error) {
		if (error instanceof FishTtsError) throw error;
		if (shared !== void 0 && shared.aborted || opts.signal?.aborted === true) throw error;
		lastError = {
			status: 0,
			message: error instanceof Error ? error.message : String(error)
		};
	}
	throw new FishTtsError(lastError.status, lastError.message);
}
/** Fetch TTS model ids from Fish Audio; returns [] when unavailable. */
async function fetchModelIds(apiKey, proxies, agents) {
	for (const proxy of [...proxies, null]) try {
		const signal = AbortSignal.timeout(2e4);
		const response = proxy === null ? await fetch(MODELS_URL, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal
		}) : await fetch(MODELS_URL, {
			headers: { Authorization: `Bearer ${apiKey}` },
			dispatcher: agents.get(proxy),
			signal
		});
		if (!response.ok) return [];
		const ids = (await response.json()).filter((item) => item.title !== void 0).map((item) => item.model_id ?? item.title).filter((id) => typeof id === "string" && id !== "");
		return ids.length > 0 ? ids : [];
	} catch {}
	return [];
}
/** Read and parse a bounded JSON body. */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}
function sendJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store"
	});
	res.end(body);
}
/** Audio content-type per format (opus → ogg container, pcm → l16). */
const AUDIO_CONTENT_TYPES = {
	wav: "audio/wav",
	mp3: "audio/mpeg",
	opus: "audio/ogg",
	pcm: "audio/l16"
};
function apply(ctx, config) {
	const store = new SettingsStore(stateDirOf(config), {
		model: config.model ?? "",
		voice: config.voice ?? "",
		format: config.format ?? "wav",
		proxy: config.proxy ?? ""
	});
	const cache = /* @__PURE__ */ new Map();
	const agents = /* @__PURE__ */ new Map();
	const getAgent = (proxy) => {
		let agent = agents.get(proxy);
		if (agent === void 0) {
			agent = new ProxyAgent(proxy);
			agents.set(proxy, agent);
		}
		return agent;
	};
	ctx.effect(() => () => {
		for (const agent of agents.values()) agent.close();
		agents.clear();
	}, "fish-tts: close proxy agents");
	const cacheKey = (text) => createHash("sha256").update(text).digest("hex");
	const buildProxies = async () => {
		const proxies = [];
		const preferred = store.effective(config).proxy;
		if (preferred !== "") {
			const normalized = proxyOf(preferred);
			if (normalized !== null) try {
				const parsed = new URL(normalized);
				const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
				const port = proxyPortOf(normalized);
				if (!local || port === null || await portOpen(port)) proxies.push(normalized);
			} catch {}
		}
		const envNormalized = proxyOf(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? "");
		if (envNormalized !== null && !proxies.includes(envNormalized)) proxies.push(envNormalized);
		return proxies;
	};
	const deliveries = new DeliveryRegistry();
	const limiter = new RateLimiter();
	const speakOutDir = () => join(store.stateDir, "out");
	const loggerLike = ctx.logger;
	const speakLog = (message) => {
		try {
			loggerLike?.info?.(`fish-tts: ${message}`);
		} catch {}
	};
	const speakWarn = (message) => {
		try {
			loggerLike?.warn?.(`fish-tts: ${message}`);
		} catch {}
	};
	if (store.speakCorrupt) speakWarn("the speak block in settings.json is invalid — the speech tool stays disabled until it is fixed or removed");
	/** Tool-path synthesis: prosody from the speak settings, a tighter timeout,
	* the caller's abort signal, and the shared in-memory cache (the prosody
	* signature is part of the key so read-aloud entries never collide). */
	const speakSynthesize = async (request) => {
		const eff = store.effective(config);
		const prosody = request.loudness || request.volumeDb !== 0 ? {
			...request.volumeDb !== 0 ? { volume: request.volumeDb } : {},
			...request.loudness ? { normalize_loudness: true } : {}
		} : void 0;
		const key = cacheKey(`${eff.model}\u0000${request.voice}\u0000${request.format}\u0000${request.text}`) + (prosody !== void 0 ? `\u0000prosody\u0000${JSON.stringify(prosody)}` : "");
		const cached = cache.get(key);
		if (cached !== void 0) return cached;
		const proxies = await buildProxies();
		const audio = await synthesize(request.text, request.voice, eff.model, request.format, store.apiKey(config), proxies, { get: getAgent }, {
			signal: request.signal,
			timeoutMs: SPEAK_SYNTH_TIMEOUT_MS,
			...prosody !== void 0 ? { prosody } : {}
		});
		if (audio.length > SPEAK_MAX_FILE_BYTES) throw new FishTtsError(0, `synthesized clip exceeds the ${SPEAK_MAX_FILE_BYTES}-byte speak cap`);
		if (cache.size >= CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest !== void 0) cache.delete(oldest);
		}
		cache.set(key, audio);
		return audio;
	};
	/** Register or unregister fish_tts_speak following the tools service and
	* the enabled flag; safe to call repeatedly (idempotent teardown first).
	* Never throws into the caller (a failed re-sync must not 500 the very
	* PUT that triggered it) — failures are logged instead. */
	let disposeTool = null;
	const syncSpeakTool = () => {
		if (disposeTool !== null) {
			try {
				disposeTool();
			} catch (error) {
				speakWarn(`tool teardown failed: ${truncate(error instanceof Error ? error.message : String(error))}`);
			}
			disposeTool = null;
		}
		try {
			const tools = ctx.get("tools");
			if (tools?.register === void 0) return;
			if (!store.effective(config).speak.enabled) return;
			const dispose = tools.register(createSpeakTool({
				settings: () => store.effective(config).speak,
				defaultVoice: () => store.effective(config).voice,
				savedVoices: () => store.summary(config).savedVoices,
				hasApiKey: () => store.apiKey(config) !== "",
				model: () => store.effective(config).model,
				synthesize: speakSynthesize,
				deliveries,
				limiter,
				outDir: speakOutDir,
				log: speakLog
			}));
			disposeTool = typeof dispose === "function" ? dispose : null;
		} catch (error) {
			disposeTool = null;
			speakWarn(`failed to register ${SPEAK_TOOL_NAME}: ${truncate(error instanceof Error ? error.message : String(error))}`);
		}
	};
	const isLoopbackAddress = (address) => {
		if (address === void 0 || address === "") return false;
		const clean = address.replace(/^::ffff:/, "").toLowerCase();
		return clean === "127.0.0.1" || clean === "::1" || clean === "localhost";
	};
	const guardLoopback = (req, res) => {
		if (!isLoopbackAddress(req.socket.remoteAddress)) {
			sendJson(res, 403, {
				ok: false,
				error: "non-loopback-forbidden"
			});
			return false;
		}
		return true;
	};
	const guardWrite = (req, res) => {
		if ((req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json") {
			sendJson(res, 415, {
				ok: false,
				error: "content-type-json-required"
			});
			return false;
		}
		const origin = req.headers.origin;
		if (origin !== void 0) {
			let originHost = "";
			try {
				originHost = new URL(origin).host;
			} catch {
				originHost = "";
			}
			const hostHeader = req.headers.host ?? "";
			const sameOrigin = originHost !== "" && originHost === hostHeader;
			const loopback = originHost.startsWith("127.0.0.1:") || originHost.startsWith("localhost:") || originHost.startsWith("[::1]:");
			if (!sameOrigin && !loopback) {
				sendJson(res, 403, {
					ok: false,
					error: "cross-origin-forbidden"
				});
				return false;
			}
		}
		return true;
	};
	let mounted = false;
	const mount = () => {
		const web = ctx.get("webServer");
		if (web === void 0 || mounted) return;
		mounted = true;
		ctx.effect(() => web.register({
			kind: "exact",
			path: "/fish-tts/synthesize",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					sendJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!guardWrite(req, res)) return;
				if (!guardLoopback(req, res)) return;
				const body = await readJsonBody(req);
				const text = typeof body?.["text"] === "string" ? body["text"] : "";
				if (text.trim() === "") {
					sendJson(res, 400, {
						ok: false,
						error: "text-required"
					});
					return;
				}
				if (text.length > MAX_TEXT_CHARS) {
					sendJson(res, 413, {
						ok: false,
						error: "text-too-large"
					});
					return;
				}
				const eff = store.effective(config);
				const requestedFormat = typeof body?.["format"] === "string" && FORMATS.has(body["format"]) ? body["format"] : eff.format;
				if (eff.voice === "") {
					sendJson(res, 400, {
						ok: false,
						error: "voice-required",
						message: "voice reference_id is required (set it in the plugin settings)"
					});
					return;
				}
				const apiKey = store.apiKey(config);
				if (apiKey === "") {
					sendJson(res, 500, {
						ok: false,
						error: "no-api-key"
					});
					return;
				}
				const key = cacheKey(`${eff.model}\u0000${eff.voice}\u0000${requestedFormat}\u0000${text}`);
				const cached = cache.get(key);
				if (cached !== void 0) {
					res.writeHead(200, {
						"content-type": AUDIO_CONTENT_TYPES[requestedFormat] ?? "audio/wav",
						"content-length": cached.length,
						"cache-control": "private, max-age=86400"
					});
					res.end(cached);
					return;
				}
				const proxies = await buildProxies();
				try {
					const audio = await synthesize(text, eff.voice, eff.model, requestedFormat, apiKey, proxies, { get: getAgent });
					if (cache.size >= CACHE_LIMIT) {
						const oldest = cache.keys().next().value;
						if (oldest !== void 0) cache.delete(oldest);
					}
					cache.set(key, audio);
					res.writeHead(200, {
						"content-type": AUDIO_CONTENT_TYPES[requestedFormat] ?? "audio/wav",
						"content-length": audio.length,
						"cache-control": "private, max-age=86400"
					});
					res.end(audio);
				} catch (error) {
					sendJson(res, error instanceof FishTtsError && error.status !== 0 ? error.status : 502, {
						ok: false,
						error: "synthesis-failed",
						message: truncate(error instanceof Error ? error.message : "synthesis failed")
					});
				}
			}
		}), "fish-tts: synthesize route");
		ctx.effect(() => web.register({
			kind: "exact",
			path: "/fish-tts/status",
			handler: (req, res) => {
				if (req.method !== "GET") {
					sendJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!guardLoopback(req, res)) return;
				sendJson(res, 200, {
					ok: true,
					...store.summary(config),
					cacheEntries: cache.size
				});
			}
		}), "fish-tts: status route");
		ctx.effect(() => web.register({
			kind: "exact",
			path: "/fish-tts/config",
			handler: async (req, res) => {
				if (!guardLoopback(req, res)) return;
				if (req.method === "GET") {
					sendJson(res, 200, {
						ok: true,
						...store.summary(config)
					});
					return;
				}
				if (req.method === "PUT") {
					if (!guardWrite(req, res)) return;
					const body = await readJsonBody(req);
					if (body === null) {
						sendJson(res, 400, {
							ok: false,
							error: "invalid-json"
						});
						return;
					}
					const patch = {};
					if (typeof body["model"] === "string") patch.model = body["model"];
					if (typeof body["voice"] === "string") patch.voice = body["voice"];
					if (Object.hasOwn(body, "savedVoices")) patch.savedVoices = body["savedVoices"];
					if (typeof body["format"] === "string") patch.format = body["format"];
					if (typeof body["proxy"] === "string") patch.proxy = body["proxy"];
					if (typeof body["apiKey"] === "string") patch.apiKey = body["apiKey"];
					if (body["clearKey"] === true) patch.clearKey = true;
					if (body["speak"] !== void 0) patch.speak = body["speak"];
					try {
						store.update(patch);
					} catch (error) {
						if (error instanceof SettingsError) sendJson(res, 400, {
							ok: false,
							error: error.code,
							message: truncate(error.message)
						});
						else sendJson(res, 500, {
							ok: false,
							error: "save-failed",
							message: truncate(error instanceof Error ? error.message : "save failed")
						});
						return;
					}
					syncSpeakTool();
					sendJson(res, 200, {
						ok: true,
						...store.summary(config)
					});
					return;
				}
				sendJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
			}
		}), "fish-tts: config route");
		ctx.effect(() => web.register({
			kind: "exact",
			path: "/fish-tts/models",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					sendJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!guardLoopback(req, res)) return;
				const apiKey = store.apiKey(config);
				const proxies = apiKey === "" ? [] : await buildProxies();
				const ids = apiKey === "" ? [] : await fetchModelIds(apiKey, proxies, { get: getAgent });
				sendJson(res, 200, {
					ok: true,
					models: ids.length > 0 ? ids : FALLBACK_MODELS,
					live: ids.length > 0
				});
			}
		}), "fish-tts: models route");
	};
	ctx.effect(() => ctx.provide("fishTts", { registerDelivery: (channel, delivery) => deliveries.register(channel, delivery) }), "fish-tts: fishTts service (channel delivery hooks)");
	cleanupSpeakFiles(speakOutDir(), SPEAK_FILE_TTL_MS);
	ctx.effect(() => {
		syncSpeakTool();
		return () => {
			if (disposeTool !== null) {
				disposeTool();
				disposeTool = null;
			}
		};
	}, `fish-tts: ${SPEAK_TOOL_NAME} lifecycle`);
	if (ctx.get("tools") === void 0) ctx.on("internal/service", (service) => {
		if (service === "tools") syncSpeakTool();
	});
	if (ctx.get("webServer") !== void 0) mount();
	else ctx.on("internal/service", (service) => {
		if (service === "webServer") mount();
	});
}

//#endregion
export { Config, apply, name };
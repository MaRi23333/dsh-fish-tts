import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import s from "@deepseek-ai/schemastery";
import { ProxyAgent, fetch } from "undici";

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
	constructor(message) {
		super(message);
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
				format: this.file.format ?? seed.format,
				proxy: this.file.proxy ?? seed.proxy,
				...this.file.apiKeyCipher !== void 0 ? { apiKeyCipher: this.file.apiKeyCipher } : {}
			};
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
			return {
				version: typeof parsed.version === "number" ? parsed.version : 0,
				model: typeof parsed.model === "string" ? parsed.model : void 0,
				voice: typeof parsed.voice === "string" ? parsed.voice : void 0,
				format: typeof parsed.format === "string" ? parsed.format : void 0,
				proxy: typeof parsed.proxy === "string" ? parsed.proxy : void 0,
				apiKeyCipher: typeof parsed.apiKeyCipher === "object" && parsed.apiKeyCipher !== null ? parsed.apiKeyCipher : void 0
			};
		} catch {
			this.parseFailed = true;
			return { version: 0 };
		}
	}
	write() {
		const temp = `${this.filePath}.tmp-${process.pid}`;
		writeFileSync(temp, JSON.stringify(this.file, null, 2), { mode: 384 });
		renameSync(temp, this.filePath);
	}
	/** Effective model/voice/format with the patch config as fallback. */
	effective(config) {
		const storedKey = this.file.apiKeyCipher !== void 0 ? decrypt(this.file.apiKeyCipher, this.key) : "";
		const model = (this.file.model ?? "").trim() || (config.model ?? "").trim() || MODEL_DEFAULT;
		const voice = (this.file.voice ?? "").trim() || (config.voice ?? "").trim() || "";
		const rawFormat = (this.file.format ?? "").trim() || (config.format ?? "").trim() || "wav";
		return {
			model,
			voice,
			format: FORMATS.has(rawFormat) ? rawFormat : "wav",
			proxy: (this.file.proxy ?? "").trim() || (config.proxy ?? "").trim() || "",
			storedKey,
			hasStoredKey: this.file.apiKeyCipher !== void 0
		};
	}
	/** Apply an edit patch; empty strings clear the field, undefined keeps it. */
	update(patch) {
		let nextProxy;
		if (patch.proxy !== void 0) nextProxy = patch.proxy.trim() === "" ? "" : validateProxyForSave(patch.proxy);
		if (patch.model !== void 0) this.file.model = patch.model.trim() === "" ? void 0 : patch.model.trim();
		if (patch.voice !== void 0) this.file.voice = patch.voice.trim() === "" ? void 0 : patch.voice.trim();
		if (patch.format !== void 0) {
			const format = patch.format.trim().toLowerCase();
			this.file.format = FORMATS.has(format) ? format : void 0;
		}
		if (patch.proxy !== void 0) this.file.proxy = nextProxy === "" ? void 0 : nextProxy;
		if (patch.clearKey === true) delete this.file.apiKeyCipher;
		else if (typeof patch.apiKey === "string" && patch.apiKey.trim() !== "") this.file.apiKeyCipher = encrypt(patch.apiKey.trim(), this.key);
		this.write();
	}
	/** Public summary: everything except key material, proxy userinfo redacted. */
	summary(config) {
		const eff = this.effective(config);
		return {
			model: eff.model,
			voice: eff.voice,
			format: eff.format,
			proxy: redactProxy(eff.proxy),
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
async function synthesize(text, voice, model, format, apiKey, proxies, agents) {
	const payload = JSON.stringify({
		text,
		reference_id: voice === "" ? null : voice,
		format,
		normalize: true,
		latency: "balanced"
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
	for (const proxy of attempts) try {
		const signal = AbortSignal.timeout(6e4);
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
					const eff = store.effective(config);
					sendJson(res, 200, {
						ok: true,
						model: eff.model,
						voice: eff.voice,
						format: eff.format,
						proxy: redactProxy(eff.proxy),
						keyConfigured: eff.storedKey !== "" || resolveEnvKey(config) !== "",
						hasStoredKey: eff.hasStoredKey
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
					if (typeof body["format"] === "string") patch.format = body["format"];
					if (typeof body["proxy"] === "string") patch.proxy = body["proxy"];
					if (typeof body["apiKey"] === "string") patch.apiKey = body["apiKey"];
					if (body["clearKey"] === true) patch.clearKey = true;
					try {
						store.update(patch);
					} catch (error) {
						if (error instanceof SettingsError) sendJson(res, 400, {
							ok: false,
							error: "invalid-proxy",
							message: truncate(error.message)
						});
						else sendJson(res, 500, {
							ok: false,
							error: "save-failed",
							message: truncate(error instanceof Error ? error.message : "save failed")
						});
						return;
					}
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
	if (ctx.get("webServer") !== void 0) mount();
	else ctx.on("internal/service", (service) => {
		if (service === "webServer") mount();
	});
}

//#endregion
export { Config, apply, name };
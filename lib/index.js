//#region src/host/session-recovery.mjs
const MAX_REQUEST_BYTES = 8 * 1024;
const assertSessionId = (sessionId) => {
	if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 512 || sessionId.includes("\0")) throw new TypeError("invalid archived session id");
	return sessionId;
};
/** Remove one id from DSH's archive set without touching its log or workspace slot. */
async function restoreArchivedSession(workspaceRegistry, sessionId) {
	const id = assertSessionId(sessionId);
	if (typeof workspaceRegistry?.enqueueOperation !== "function" || typeof workspaceRegistry?.requireState !== "function" || typeof workspaceRegistry?.setState !== "function") throw new Error("unsupported workspace registry restore seam");
	return workspaceRegistry.enqueueOperation(async () => {
		const state = workspaceRegistry.requireState();
		if (!Array.isArray(state?.archivedSessionIds)) throw new Error("unsupported workspace registry restore state");
		if (!state.archivedSessionIds.includes(id)) return {
			restored: false,
			archivedSessionIds: [...state.archivedSessionIds]
		};
		const archivedSessionIds = state.archivedSessionIds.filter((candidate) => candidate !== id);
		await workspaceRegistry.setState({
			...state,
			archivedSessionIds
		});
		return {
			restored: true,
			archivedSessionIds
		};
	});
}
const sendJson = (res, status, payload) => {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(payload));
};
const failure = (code, message) => ({
	ok: false,
	error: {
		code,
		message
	}
});
const readJsonBody = async (req) => {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) throw new Error("request-too-large");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
/** Strict same-origin POST boundary for the single restore operation. */
function createRestoreRequestHandler({ restore, warn = console.warn }) {
	return async (req, res) => {
		if (req.method !== "POST") {
			sendJson(res, 405, failure("method-not-allowed", "Only POST can restore an archived session."));
			return;
		}
		const host = req.headers.host;
		if (typeof host !== "string" || req.headers.origin !== `http://${host}`) {
			sendJson(res, 403, failure("forbidden", "The restore request failed its same-origin check."));
			return;
		}
		if (req.headers["x-dsh-chat-manager-action"] !== "restore-session") {
			sendJson(res, 403, failure("forbidden", "The restore request is missing its explicit action marker."));
			return;
		}
		const contentType = req.headers["content-type"];
		if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
			sendJson(res, 415, failure("unsupported-media-type", "The restore request must use JSON."));
			return;
		}
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			const tooLarge = error instanceof Error && error.message === "request-too-large";
			sendJson(res, tooLarge ? 413 : 400, failure(tooLarge ? "request-too-large" : "invalid-json", "The restore request body is invalid."));
			return;
		}
		try {
			const sessionId = assertSessionId(body?.sessionId);
			sendJson(res, 200, {
				ok: true,
				value: await restore(sessionId)
			});
		} catch (error) {
			if (error instanceof TypeError) {
				sendJson(res, 400, failure("invalid-session-id", "The archived session id is invalid."));
				return;
			}
			warn("archived session restore failed:", error);
			sendJson(res, 500, failure("restore-failed", "The archived session was not confirmed restored."));
		}
	};
}
//#endregion
//#region src/index.js
const name = "dsh-chat-manager";
const inject = ["webServer", "workspaceRegistry"];
function apply(ctx) {
	const handler = createRestoreRequestHandler({ restore: (sessionId) => restoreArchivedSession(ctx.workspaceRegistry, sessionId) });
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/plugins/dsh-chat-manager/restore",
		handler
	}), "dsh-chat-manager: archived session restore route");
}
//#endregion
export { apply, createRestoreRequestHandler, inject, name, restoreArchivedSession };

import { fetchSyncBackend } from "../_syncBackend.js";

export async function onRequestPost({ request, env }) {
  return fetchSyncBackend(request, env);
}

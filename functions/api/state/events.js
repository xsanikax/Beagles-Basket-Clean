import { fetchSyncBackend } from "../../_syncBackend.js";

export async function onRequestGet({ request, env }) {
  return fetchSyncBackend(request, env);
}

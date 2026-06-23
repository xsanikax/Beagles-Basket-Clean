const ROOM_NAME = "household";
const DEFAULT_WORKER_URL = "https://beagles-basket-realtime-workar.xsanikax.workers.dev";

export const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function getRoom(env) {
  if (!env.BASKET_ROOM) return null;
  const id = env.BASKET_ROOM.idFromName(ROOM_NAME);
  return env.BASKET_ROOM.get(id);
}

async function fetchWorker(request, env) {
  const target = new URL(request.url);
  const base = (env.SYNC_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/+$/, "");
  target.protocol = new URL(base).protocol;
  target.hostname = new URL(base).hostname;
  target.port = new URL(base).port;
  target.username = "";
  target.password = "";

  return fetch(target.toString(), new Request(target.toString(), request));
}

export async function fetchSyncBackend(request, env) {
  const room = getRoom(env);
  if (room) {
    try {
      const response = await room.fetch(request.clone());
      if (response.status < 500) return response;
      console.warn("BASKET_ROOM returned", response.status, "falling back to Worker URL");
    } catch (error) {
      console.warn("BASKET_ROOM failed, falling back to Worker URL", error);
    }
  }

  return fetchWorker(request, env);
}

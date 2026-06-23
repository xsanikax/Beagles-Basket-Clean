const ROOM_NAME = "household";

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function getRoom(env) {
  if (!env.BASKET_ROOM) return null;
  const id = env.BASKET_ROOM.idFromName(ROOM_NAME);
  return env.BASKET_ROOM.get(id);
}

export async function onRequestGet({ request, env }) {
  const room = getRoom(env);
  if (!room) return json({ error: "Missing BASKET_ROOM Durable Object binding" }, 500);
  return room.fetch(request);
}

export async function onRequestPut({ request, env }) {
  const room = getRoom(env);
  if (!room) return json({ error: "Missing BASKET_ROOM Durable Object binding" }, 500);
  return room.fetch(request);
}

# Beagle's Basket - Cloudflare Pages realtime fix

This version makes the cloud/Durable Object state authoritative on load, restores `/api/state/events`, and polls every 3 seconds as a fallback so two phones stay in sync even if EventSource/SSE is interrupted.

Cloudflare Pages settings:

- Root directory: `beagles-basket`
- Build command: blank
- Build output directory: `public`

Required Pages binding:

- Type: Durable Object
- Variable name: `BASKET_ROOM`
- Worker/service: `beagles-basket-realtime-workar`
- Class: `BasketRoom`

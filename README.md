# Enfyra Next Chat App

Next.js version of the Enfyra demo chat app. It uses the same third-party app shape as the Nuxt demo:

- REST calls go to local `/enfyra/**`, proxied to Enfyra App `/api/**`.
- Socket.IO uses namespace `/chat` and local path `/socket.io`, proxied to Enfyra App `/ws/socket.io`.
- OAuth starts at Enfyra App `/api/auth/google` and uses `cookieBridgePrefix=/enfyra`.
- Password login, OAuth, refresh cookies, REST permissions, and realtime chat behavior are owned by Enfyra.

## Config

The integration config lives in `lib/enfyra-config.ts` and `next.config.ts`.
For a third-party Next app, these are the important parts:

1. REST calls stay same-origin under `/enfyra/**`.
2. Socket.IO transport stays same-origin under `/socket.io/**`.
3. OAuth sends `cookieBridgePrefix=/enfyra`, so Enfyra can redirect back through this app and set cookies for this origin.

With these rewrites in place, the chat app can call Enfyra auth, REST, refresh-token, and Socket.IO without extra server routes in Next.
`proxy.ts` also checks `/enfyra/me` before rendering `/` or `/chat`, so an anonymous visitor goes straight to `/login` without briefly rendering the chat UI.

```bash
NEXT_PUBLIC_ENFYRA_APP_URL=https://demo.enfyra.io
```

```ts
// next.config.ts
rewrites:
  /enfyra/:path* -> https://demo.enfyra.io/api/:path*
  /socket.io/:path* -> https://demo.enfyra.io/ws/socket.io/:path*
```

Default local port is `3005`.

## Run

```bash
yarn install
yarn dev
```

Open `http://127.0.0.1:3005`.

## Deploy

The GitHub Actions workflow deploys to `/apps/enfyra-next-chat-app`, builds with `yarn build`, and runs PM2 on `127.0.0.1:3005`.

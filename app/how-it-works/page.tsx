"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  Cable,
  DatabaseZap,
  MessageSquareText,
  Network,
  RadioTower,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { enfyraConfig } from "@/lib/enfyra-config";

type Tab = "runtime" | "setup" | "next";

const tabs: Array<{ id: Tab; label: string; icon: typeof Workflow }> = [
  { id: "runtime", label: "Runtime flow", icon: Workflow },
  { id: "setup", label: "Enfyra setup", icon: DatabaseZap },
  { id: "next", label: "Next app", icon: Network },
];

const eventRows = [
  ["connect", "Socket.IO opens the /chat namespace through the Next /socket.io proxy.", "Enfyra runs the dynamic gateway connection script, resolves @USER, joins user_<id>, then acknowledges the socket."],
  ["chat:join", "The client asks Enfyra to join all conversation rooms for the current user.", "The websocket script reads memberships and joins conversation:<id> rooms."],
  ["chat:new", "The client sends DM/group members and optional first text.", "The server creates chat_conversation, chat_conversation_member rows, optionally chat_message, then emits chat:new."],
  ["chat:message", "The client sends a messageId, conversationId, and text.", "The server persists chat_message, points chat_conversation.lastMessage to that row, then emits chat:message to the room."],
  ["chat:read", "The active conversation emits read state when opened or updated.", "The server updates chat_message_read rows and emits chat:read so unread dots clear."],
  ["chat:typing", "Focus/input activity emits isTyping for the selected room.", "The server rebroadcasts transient typing state to the room without writing the database."],
  ["chat:presence", "The client sends the user IDs it needs online state for.", "The server checks Socket.IO user rooms cluster-wide and returns chat:presence:state."],
  ["chat:delete", "The client asks to leave or delete a DM for everyone.", "The server removes memberships, cascades empty conversations, and message delete hooks keep lastMessage pointing at the newest remaining row."],
];

export default function HowItWorksPage() {
  const [active, setActive] = useState<Tab>("runtime");
  const ActiveIcon = tabs.find((tab) => tab.id === active)?.icon || Workflow;

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="docs-page">
      <div className="app-grid-bg" />
      <section className="docs-shell">
        <header className="docs-header">
          <div className="docs-title">
            <p className="eyebrow">Powered by Enfyra</p>
            <h1>How the Next chat app works</h1>
            <p>
              This app is a third-party frontend. It keeps its own Next UI, while Enfyra owns auth,
              dynamic REST, realtime Socket.IO, RLS, persistence, cache reloads, and runtime scripts
              without restarting the backend.
            </p>
          </div>
          <a className="text-button" href="/chat">
            <MessageSquareText size={17} />
            Back to chat
          </a>
        </header>

        <nav className="docs-tabs" aria-label="How it works sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}>
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="docs-grid">
          <article className="guide-card panel" id="overview">
            <p className="eyebrow"><ActiveIcon size={14} /> Current section</p>
            {active === "runtime" ? <RuntimeFlow jumpTo={jumpTo} /> : null}
            {active === "setup" ? <EnfyraSetup jumpTo={jumpTo} /> : null}
            {active === "next" ? <NextSetup jumpTo={jumpTo} /> : null}
          </article>
        </div>
      </section>
    </main>
  );
}

function RuntimeFlow({ jumpTo }: { jumpTo: (id: string) => void }) {
  return (
    <>
      <h2>Runtime flow</h2>
      <p>
        The browser never talks to the hidden Express backend directly. It talks to this Next app,
        Next proxies `/enfyra/*` to Enfyra REST and `/socket.io/*` to the Enfyra Socket.IO bridge,
        then Enfyra dynamic routes and websocket scripts do the backend work.
      </p>
      <div className="guide-links">
        <button onClick={() => jumpTo("login-flow")}>Login to cookie bridge</button>
        <button onClick={() => jumpTo("socket-flow")}>Socket connect</button>
        <button onClick={() => jumpTo("event-map")}>Emit/listen map</button>
      </div>

      <section id="login-flow" className="guide-card panel">
        <h2>1. Login and OAuth</h2>
        <p>
          Password login posts to `/enfyra/login`, which Next rewrites to Enfyra `/api/login`.
          Google login redirects to Enfyra `/api/auth/google` with an absolute `redirect` and a
          `cookieBridgePrefix`. After Google finishes, Enfyra redirects back through{" "}
          <code>{"{origin}{cookieBridgePrefix}/auth/set-cookies"}</code>, so the final response can set cookies on
          the third-party app origin and then send the user to `/chat`.
        </p>
        <CodeBlock>{`/login button
  -> ${enfyraConfig.enfyraAppUrl}/api/auth/google
     ?redirect=<current-origin>/chat
     &cookieBridgePrefix=${enfyraConfig.apiProxyPrefix}

Google callback
  -> Enfyra validates state
  -> <current-origin>${enfyraConfig.apiProxyPrefix}/auth/set-cookies
  -> Next proxy forwards to Enfyra /api/auth/set-cookies
  -> Set-Cookie is returned on the third app origin
  -> redirect /chat`}</CodeBlock>
      </section>

      <section id="socket-flow" className="guide-card panel">
        <h2>2. Socket connect</h2>
        <p>
          The client opens the `/chat` namespace with `path: "/socket.io"`. Next rewrites the
          Engine.IO polling transport to Enfyra `/ws/socket.io`. Enfyra authenticates from cookies,
          runs the dynamic websocket connection script, loads `@USER`, and joins `user_&lt;id&gt;`
          for per-user delivery.
        </p>
        <CodeBlock>{`io("${enfyraConfig.websocketNamespace}", {
  path: "${enfyraConfig.websocketPath}",
  withCredentials: true,
  transports: ["polling"],
  upgrade: false,
})`}</CodeBlock>
      </section>

      <section id="event-map" className="guide-card panel">
        <h2>3. Emit/listen map</h2>
        <p>
          Each client emit has a matching dynamic websocket event in Enfyra. Server-side scripts
          explicitly persist with `@REPOS`, join rooms with `@SOCKET`, and emit back to rooms/users.
        </p>
        <div className="event-map">
          {eventRows.map(([event, client, server]) => (
            <div className="event-row" key={event} id={`event-${event.replace(":", "-")}`}>
              <strong>{event}</strong>
              <span>{client}</span>
              <ArrowRightLeft size={16} />
              <span>{server}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function EnfyraSetup({ jumpTo }: { jumpTo: (id: string) => void }) {
  return (
    <>
      <h2>Enfyra setup</h2>
      <p>
        Enfyra provides the backend surface from metadata: tables, relations, RLS, route
        permissions, REST endpoints, and websocket events. Changing table metadata or websocket
        scripts triggers partial cache reloads; the app does not need a backend restart.
      </p>
      <div className="guide-links">
        <button onClick={() => jumpTo("tables")}>Tables</button>
        <button onClick={() => jumpTo("rls")}>RLS and read state</button>
        <button onClick={() => jumpTo("ws-events")}>Websocket scripts</button>
      </div>

      <section id="tables" className="guide-card panel">
        <h2>Tables and relations</h2>
        <p>
          The chat app uses `chat_conversation`, `chat_conversation_member`, `chat_message`, and
          `chat_message_read`. Members link conversations to `user_definition`. Message reads are
          separate so unread state can be queried by user without scanning all message rows.
        </p>
      </section>

      <section id="rls" className="guide-card panel">
        <h2>RLS and unread data</h2>
        <p>
          The frontend can ask for conversations through the current member rows and rely on Enfyra
          RLS to keep users inside their own data boundary. Unread state comes from
          `chat_message_read` filtered by current user and `isRead = false`; opening a room emits
          `chat:read`, and Enfyra updates those rows.
        </p>
      </section>

      <section id="ws-events" className="guide-card panel">
        <h2>Dynamic websocket events</h2>
        <p>
          The `/chat` Socket.IO namespace is configured inside Enfyra. Event scripts are runtime
          code, not generated source files. They can use `@USER`, `@SOCKET`, `@REPOS`, and room
          helpers to persist messages, fan out to `conversation:&lt;id&gt;`, and target
          `user_&lt;id&gt;` across cluster instances.
        </p>
        <CodeBlock>{`client emit chat:message
  -> Enfyra dynamic websocket event "chat:message"
  -> @REPOS.chat_message.create(...)
  -> @REPOS.chat_conversation.update({ lastMessage: persistedMessage })
  -> @SOCKET.to("conversation:<id>").emit("chat:message", payload)`}</CodeBlock>
      </section>
    </>
  );
}

function NextSetup({ jumpTo }: { jumpTo: (id: string) => void }) {
  return (
    <>
      <h2>Next app</h2>
      <p>
        Next only owns UI state and a small proxy configuration. This is the key point: once
        `next.config.ts` rewrites REST to `/api` and Socket.IO to `/ws/socket.io`, the app can use
        Enfyra auth, refresh-token cookies, REST, OAuth, and realtime without building extra backend
        routes in Next.
      </p>
      <div className="guide-links">
        <button onClick={() => jumpTo("next-config")}>Config</button>
        <button onClick={() => jumpTo("next-auth-gate")}>Auth gate</button>
        <button onClick={() => jumpTo("api-client")}>REST client</button>
        <button onClick={() => jumpTo("ui-features")}>UI features</button>
      </div>

      <section id="next-config" className="guide-card panel">
        <h2>Proxy config</h2>
        <p>
          This is the only infrastructure config the Next app needs. `/enfyra/:path*` forwards to
          Enfyra `/api/:path*`; `/socket.io/:path*` forwards to Enfyra `/ws/socket.io/:path*`.
          Because the browser calls the Next origin, cookies are carried by normal same-origin
          credential handling.
        </p>
        <CodeBlock>{`// next.config.ts
const nextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "${enfyraConfig.apiProxyPrefix}/:path*",
        destination: "${enfyraConfig.enfyraApiUrl}/:path*",
      },
      {
        source: "/socket.io/:path*",
        destination: "${enfyraConfig.enfyraAppUrl}/ws/socket.io/:path*",
      },
      {
        source: "/socket.io/",
        destination: "${enfyraConfig.enfyraAppUrl}/ws/socket.io/",
      },
      {
        source: "/socket.io",
        destination: "${enfyraConfig.enfyraAppUrl}/ws/socket.io/",
      },
    ]
  },
}`}</CodeBlock>
        <p>
          After that, the client code can stay simple: call `fetch("/enfyra/...")` with
          `credentials: "include"`, and connect Socket.IO with namespace `/chat` plus path
          `/socket.io`.
        </p>
        <CodeBlock>{`fetch("/enfyra/me", { credentials: "include" })

io("/chat", {
  path: "/socket.io",
  withCredentials: true,
  transports: ["polling"],
  upgrade: false,
})`}</CodeBlock>
      </section>

      <section id="next-auth-gate" className="guide-card panel">
        <h2>Route auth gate</h2>
        <p>
          `proxy.ts` checks `/enfyra/me` before rendering `/` or `/chat`. Anonymous users go
          directly to `/login`, so the chat interface never flashes before the redirect. When Enfyra
          refreshes cookies during `/me`, the proxy forwards the `Set-Cookie` header back to
          the browser.
        </p>
        <CodeBlock>{`// proxy.ts
if (pathname === "/") {
  return redirect(authenticated ? "/chat" : "/login")
}

if (pathname.startsWith("/chat") && !authenticated) {
  return redirect("/login")
}`}</CodeBlock>
      </section>

      <section id="api-client" className="guide-card panel">
        <h2>REST client</h2>
        <p>
          `lib/enfyra-api.ts` wraps `fetch` with `credentials: "include"`, maps Enfyra response
          rows, and keeps queries small: load the conversation list first, load messages only when a
          conversation is selected, and request older pages in chunks of 20.
        </p>
      </section>

      <section id="ui-features" className="guide-card panel">
        <h2>UI features</h2>
        <p>
          The Next UI includes the complete chat surface: DM and group creation, mobile conversation
          drawer, active conversation details, read/unread dots, typing state, online presence, load
          older messages, optimistic sends with REST fallback, and delete/leave confirmation.
        </p>
        <div className="feature-grid">
          <span><ShieldCheck size={16} /> Enfyra auth and cookie bridge</span>
          <span><RadioTower size={16} /> Socket.IO realtime</span>
          <span><Cable size={16} /> Same-origin Next proxy</span>
          <span><DatabaseZap size={16} /> Dynamic REST persistence</span>
        </div>
      </section>
    </>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="code-block">
      <pre>{children}</pre>
    </div>
  );
}

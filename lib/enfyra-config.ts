const trimRightSlash = (value: string) => value.replace(/\/+$/, "");

const enfyraAppUrl = trimRightSlash(
  process.env.NEXT_PUBLIC_ENFYRA_APP_URL ||
    process.env.ENFYRA_APP_URL ||
    "https://demo.enfyra.io"
);

export const enfyraConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Enfyra Next Chat",
  enfyraAppUrl,
  enfyraApiUrl: `${enfyraAppUrl}/api`,
  apiProxyPrefix: "/enfyra",
  websocketNamespace: "/chat",
  websocketPath: "/socket.io",
};

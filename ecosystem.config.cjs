module.exports = {
  apps: [
    {
      name: 'enfyra-next-chat-app',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3005',
      env: {
        NODE_ENV: 'production',
        PORT: '3005',
        NEXT_PUBLIC_ENFYRA_APP_URL: 'https://demo.enfyra.io',
      },
      watch: false,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
}

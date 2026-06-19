module.exports = {
  apps: [{
    name: 'ai-learning',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
      JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
    }
  }]
};

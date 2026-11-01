import { config, requireConfig } from './config.js';
import { createApp } from './app.js';
import { passwordHasherName } from './lib/crypto.js';

requireConfig();
const app = createApp();
const hasher = await passwordHasherName();
app.listen(config.port, () => {
  console.log(`A Little Place Called Us API listening on port ${config.port} (password hasher: ${hasher})`);
});

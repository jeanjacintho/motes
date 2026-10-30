import { loadConfig } from './config.js';

try {
  loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration');
  process.exitCode = 1;
}

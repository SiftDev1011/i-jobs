import 'reflect-metadata';
import { createApp } from './bootstrap';
import { CONFIG, AppConfig } from './config/config';
import { rootLogger } from './logger';

async function main() {
  const app = await createApp();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
  rootLogger.info(`API listening on port ${config.PORT}`);
}

main().catch((e) => {
  rootLogger.fatal(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

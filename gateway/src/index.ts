import "dotenv/config";
import { loadConfig } from "./config";
import { createGateway } from "./app";

const cfg = loadConfig();
const gw = createGateway(cfg);
gw.epochs.start();
const server = gw.app.listen(cfg.port, () => {
  console.log(
    `[gateway] :${cfg.port} · mode=${cfg.aipgMode} · chain ${cfg.chainId} · plan ${cfg.planId} · epoch ${cfg.epochSeconds}s` +
      (cfg.aipgMode === "live" ? ` · live budget ${cfg.maxLiveRequests}` : ""),
  );
});

function shutdown() {
  server.close(() => {
    gw.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

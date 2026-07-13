import { ensureVersionFile, getVersionCode } from "./dev-build-metadata.mjs";

const versionName = ensureVersionFile();
process.stdout.write(
  JSON.stringify({
    versionName,
    versionCode: getVersionCode(versionName),
  }),
);

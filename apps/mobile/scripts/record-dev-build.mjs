import path from "node:path";
import { fileURLToPath } from "node:url";

import { getVersionCode, recordDevBuild } from "./dev-build-metadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return process.argv[index + 1];
}

const apkPath = path.resolve(readArg("--apk"));
const versionName = readArg("--version");
const versionCode = Number.parseInt(readArg("--code"), 10) || getVersionCode(versionName);

const record = recordDevBuild({
  versionName,
  versionCode,
  apkPath,
  variant: "debug",
});

process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

// src/index.ts
import chalk from "chalk";
import ora from "ora";
var theme = {
  primary: chalk.hex("#6366f1"),
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray
};
var globalFlags = {};
function setGlobalCliFlags(flags) {
  globalFlags = { ...flags };
}
function getGlobalCliFlags() {
  return { ...globalFlags };
}
function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}
function outputLine(message, kind = "info") {
  if (globalFlags.json) return;
  const fn = theme[kind] ?? theme.info;
  console.log(fn(message));
}
async function runStep(label, fn, verbose) {
  if (globalFlags.json) {
    return fn();
  }
  const spinner = ora(label).start();
  try {
    const result = await fn();
    spinner.succeed(label);
    return result;
  } catch (e) {
    spinner.fail(label);
    const msg = e instanceof Error ? e.message : String(e);
    if (verbose || globalFlags.verbose) {
      console.error(e);
    } else {
      console.error(theme.error(msg));
    }
    throw e;
  }
}
export {
  getGlobalCliFlags,
  outputJson,
  outputLine,
  runStep,
  setGlobalCliFlags,
  theme
};
//# sourceMappingURL=index.js.map
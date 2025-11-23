// handshake.js (CommonJS, for the protected app)
// Centralizes the "verify or quit" handshake logic used at startup.

const { app, dialog } = require("electron");

// Keep the same static shared secret to avoid behavior changes.
// (You can later swap this for a stronger one-time token scheme.)
const HANDSHAKE_PASSWORD = "thvac-pro-2026.1.0-handshake-5f7c1a4e9b2d";

/**
 * Checks for a valid handshake secret in:
 *  - process.env.TENSORHVAC_HANDSHAKE
 *  - process.env.THVAC_HANDSHAKE
 *  - CLI arg: --handshake=<secret>
 */
function hasValidHandshake(argv = process.argv, env = process.env) {
  const env1 = env.TENSORHVAC_HANDSHAKE;
  const env2 = env.THVAC_HANDSHAKE;
  const arg = (argv || []).find((a) => typeof a === "string" && a.startsWith("--handshake="));
  const fromArg = arg ? arg.split("=", 2)[1] : undefined;
  return [env1, env2, fromArg].some((v) => v && v === HANDSHAKE_PASSWORD);
}

/**
 * Displays a blocking dialog and quits the app.
 * Call via: app.whenReady().then(abortForInvalidHandshake)
 */
function abortForInvalidHandshake() {
  const msg =
    "tensorHVAC-Pro-2026.1.0 cannot be launched directly.\n\n" +
    "Please start the app from the license checker (tensorHVAC-license-validation).";
  dialog.showErrorBox("Launch Blocked", msg);
  app.quit();
}

/**
 * Convenience helper:
 * If handshake is invalid, schedule the abort and return false.
 * If valid, return true (caller can set a flag like `handshakeOK = true`).
 */
function enforceHandshake() {
  const ok = hasValidHandshake();
  if (!ok) app.whenReady().then(abortForInvalidHandshake);
  return ok;
}

module.exports = {
  HANDSHAKE_PASSWORD,
  hasValidHandshake,
  abortForInvalidHandshake,
  enforceHandshake,
};

const SHARED_TERRAIN_MESSAGES = Object.freeze({
  admission_timeout: "The shared terrain session request timed out before the broker responded. Check your connection and retry; no direct token fallback was used.",
  admission_unavailable: "Shared terrain access is temporarily paused. Try again later or use your own Cesium token in Game access.",
  admission_unconfirmed: "Shared terrain access is not currently confirmed. Try again later or use your own Cesium token in Game access.",
  no_confirmed_remaining_budget: "The confirmed shared terrain limit is currently unavailable. Use your own Cesium token in Game access or try again later.",
  no_confirmed_monthly_budget: "The confirmed shared terrain limit is currently unavailable. Use your own Cesium token in Game access or try again later.",
  monthly_budget_exhausted: "The confirmed shared terrain limit has been reached. Use your own Cesium token in Game access or try again after a confirmed reset.",
  period_unavailable: "Shared terrain access is outside its confirmed availability period. Try again later or use your own Cesium token in Game access.",
  budget_busy: "Shared terrain admission is busy. Wait a moment and retry, or use your own Cesium token in Game access.",
  session_busy: "Shared terrain admission is busy. Wait a moment and retry, or use your own Cesium token in Game access.",
  configuration_unconfirmed: "Shared terrain access is not fully configured. Try again later or use your own Cesium token in Game access.",
  baseline_unconfirmed: "Shared terrain usage has not been confirmed. Try again later or use your own Cesium token in Game access.",
  ledger_unavailable: "Shared terrain accounting is temporarily unavailable. Try again later or use your own Cesium token in Game access.",
  request_already_claimed: "The broker had already processed this terrain request when its response was lost. A second shared allocation was prevented. You can consciously retry the departure or use your own Cesium token in Game access.",
  terrain_session_unavailable: "The terrain provider could not open a session. Try again later or use your own Cesium token in Game access.",
});

export function terrainLoadErrorMessage(event, { userToken = false } = {}) {
  // The renderer reports both a failed root (tile === null) and ordinary
  // descendant tile failures through the same event. A missing distant tile is
  // not a global connection failure and must not take over the lobby status.
  if (!event || event.tile !== null) return null;

  if (userToken) {
    return "Terrain could not load with your Cesium token. Check the token, assets:read, asset 2275207, Allowed URLs and your account quota, or return to Game access.";
  }

  const reason = typeof event.error?.terrainReason === "string"
    ? event.error.terrainReason
    : "";
  return SHARED_TERRAIN_MESSAGES[reason]
    || "Terrain could not start. Check your connection, try again later, or use your own Cesium token in Game access.";
}

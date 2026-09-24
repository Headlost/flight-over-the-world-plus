const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const DEFAULT_FOCUS_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role=button]:not([aria-disabled=true])",
  "[role=menuitem]:not([aria-disabled=true])",
  "[role=option]:not([aria-disabled=true])",
  "[data-gamepad-focusable]:not([aria-disabled=true])",
].join(",");

export const GAMEPAD_DEFAULTS = Object.freeze({
  deadzone: 0.16,
  buttonThreshold: 0.5,
  activityThreshold: 0.2,
  navigationThreshold: 0.55,
  triggerDeadzone: 0.08,
  repeatDelay: 360,
  repeatInterval: 90,
  mode: "auto",
  layout: "auto",
  haptics: true,
  hapticsIntensity: 1,
  storageKey: "flight-over-the-world.gamepad-controls.v1",
  focusSelector: DEFAULT_FOCUS_SELECTOR,
});

const STANDARD_AXES = Object.freeze({
  moveX: 0,
  moveY: 1,
  lookX: 2,
  lookY: 3,
});

const STANDARD_BUTTONS = Object.freeze({
  faceSouth: 0,
  faceEast: 1,
  faceWest: 2,
  faceNorth: 3,
  leftShoulder: 4,
  rightShoulder: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  select: 8,
  pause: 9,
  center: 10,
  rightStick: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  home: 16,
});

export const STANDARD_GAMEPAD_MAPPING = Object.freeze({
  axes: STANDARD_AXES,
  buttons: STANDARD_BUTTONS,
});

// Non-standard controllers often expose this same positional layout. Callers
// can override any index with `genericMapping` when a device reports another
// arrangement; unknown/missing indices are always read as neutral.
export const GENERIC_GAMEPAD_MAPPING = STANDARD_GAMEPAD_MAPPING;

const HAPTIC_PATTERNS = {
  navigation: Object.freeze({ duration: 16, weakMagnitude: 0.12, strongMagnitude: 0.04 }),
  confirm: Object.freeze({ duration: 42, weakMagnitude: 0.28, strongMagnitude: 0.18 }),
  back: Object.freeze({ duration: 34, weakMagnitude: 0.2, strongMagnitude: 0.1 }),
  impact: Object.freeze({ duration: 130, weakMagnitude: 0.5, strongMagnitude: 0.9 }),
};

export const GAMEPAD_HAPTIC_PATTERNS = Object.freeze(HAPTIC_PATTERNS);

const FAMILY_LABELS = Object.freeze({
  xbox: Object.freeze({
    faceSouth: "A",
    faceEast: "B",
    faceWest: "X",
    faceNorth: "Y",
    leftShoulder: "LB",
    rightShoulder: "RB",
    leftTrigger: "LT",
    rightTrigger: "RT",
    select: "View",
    pause: "Menu",
    center: "L3",
    rightStick: "R3",
    home: "Xbox",
  }),
  playstation: Object.freeze({
    faceSouth: "Cross",
    faceEast: "Circle",
    faceWest: "Square",
    faceNorth: "Triangle",
    leftShoulder: "L1",
    rightShoulder: "R1",
    leftTrigger: "L2",
    rightTrigger: "R2",
    select: "Create/Share",
    pause: "Options",
    center: "L3",
    rightStick: "R3",
    home: "PS",
  }),
  nintendo: Object.freeze({
    faceSouth: "B",
    faceEast: "A",
    faceWest: "Y",
    faceNorth: "X",
    leftShoulder: "L",
    rightShoulder: "R",
    leftTrigger: "ZL",
    rightTrigger: "ZR",
    select: "-",
    pause: "+",
    center: "Left Stick",
    rightStick: "Right Stick",
    home: "Home",
  }),
  generic: Object.freeze({
    faceSouth: "Button 1",
    faceEast: "Button 2",
    faceWest: "Button 3",
    faceNorth: "Button 4",
    leftShoulder: "Left Shoulder",
    rightShoulder: "Right Shoulder",
    leftTrigger: "Left Trigger",
    rightTrigger: "Right Trigger",
    select: "Select",
    pause: "Menu",
    center: "Left Stick",
    rightStick: "Right Stick",
    home: "Home",
  }),
});

const ACTION_BUTTONS = Object.freeze([
  "confirm",
  "back",
  "secondary",
  "special",
  "leftShoulder",
  "rightShoulder",
  "brake",
  "boost",
  "settings",
  "pause",
  "center",
  "navUp",
  "navDown",
  "navLeft",
  "navRight",
]);

const NAVIGATION_ACTIONS = Object.freeze({
  navUp: "up",
  navDown: "down",
  navLeft: "left",
  navRight: "right",
});

const EMPTY_BUTTONS = Object.freeze({
  confirm: false,
  back: false,
  primary: false,
  secondary: false,
  special: false,
  leftShoulder: false,
  rightShoulder: false,
  brake: false,
  boost: false,
  settings: false,
  pause: false,
  center: false,
  up: false,
  down: false,
  left: false,
  right: false,
  navUp: false,
  navDown: false,
  navLeft: false,
  navRight: false,
});

const EMPTY_AXES = Object.freeze({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 });
const EMPTY_VALUES = Object.freeze({ brake: 0, boost: 0 });
const EMPTY_FLIGHT = Object.freeze({
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0,
  cameraClimb: 0,
  lookX: 0,
  lookY: 0,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function safeArray(value) {
  if (!value || typeof value.length !== "number") return [];
  try {
    return Array.from(value);
  } catch {
    return [];
  }
}

/** Remove a circular dead zone while preserving direction and full range. */
export function normalizeStick(x, y, options = {}) {
  const config = typeof options === "number" ? { deadzone: options } : (options || {});
  const deadzone = clamp(finite(config.deadzone, GAMEPAD_DEFAULTS.deadzone), 0, 0.95);
  const curve = Math.max(0.1, finite(config.curve, 1));
  const rawX = clamp(finite(x), -1, 1);
  const rawY = clamp(finite(y), -1, 1);
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude <= deadzone || magnitude <= 1e-9) return { x: 0, y: 0, magnitude: 0 };

  const clampedMagnitude = Math.min(1, magnitude);
  const remapped = Math.pow((clampedMagnitude - deadzone) / (1 - deadzone), curve);
  return {
    x: (rawX / magnitude) * remapped,
    y: (rawY / magnitude) * remapped,
    magnitude: remapped,
  };
}

export const applyRadialDeadzone = normalizeStick;

/** Identify labels/layout only. Never use the id as a stable device identifier. */
export function identifyGamepadFamily(gamepadOrId) {
  const id = String(typeof gamepadOrId === "string" ? gamepadOrId : gamepadOrId?.id || "").toLowerCase();
  if (/nintendo|joy[ -]?con|switch.*controller|pro controller|\b057e\b/.test(id)) return "nintendo";
  if (/xbox|xinput|x-box|microsoft|\b045e\b/.test(id)) return "xbox";
  if (/playstation|dualshock|dualsense|sony|\b054c\b|wireless controller/.test(id)) return "playstation";
  return "generic";
}

/** Nintendo's labelled A/B positions are reversed relative to the web standard map. */
export function getConfirmBackButtons(familyOrGamepad) {
  const family = FAMILY_LABELS[familyOrGamepad]
    ? familyOrGamepad
    : identifyGamepadFamily(familyOrGamepad);
  return family === "nintendo"
    ? { confirm: 1, back: 0 }
    : { confirm: 0, back: 1 };
}

export function getGamepadButtonLabels(familyOrGamepad) {
  const family = FAMILY_LABELS[familyOrGamepad]
    ? familyOrGamepad
    : identifyGamepadFamily(familyOrGamepad);
  const base = FAMILY_LABELS[family] || FAMILY_LABELS.generic;
  const layout = getConfirmBackButtons(family);
  const byIndex = [base.faceSouth, base.faceEast, base.faceWest, base.faceNorth];
  return Object.freeze({
    ...base,
    confirm: byIndex[layout.confirm],
    back: byIndex[layout.back],
    confirmIndex: layout.confirm,
    backIndex: layout.back,
  });
}

function resolveAxis(axes, specification) {
  const config = specification && typeof specification === "object"
    ? specification
    : { index: specification };
  const index = Number.isInteger(config.index) ? config.index : -1;
  const value = index >= 0 ? finite(axes[index]) : 0;
  const scale = finite(config.scale, 1);
  return clamp(value * scale * (config.invert ? -1 : 1), -1, 1);
}

function readButton(buttons, index, threshold) {
  if (!Number.isInteger(index) || index < 0 || index >= buttons.length) {
    return { pressed: false, touched: false, value: 0 };
  }
  const raw = buttons[index];
  if (typeof raw === "number") {
    const value = clamp(finite(raw), 0, 1);
    return { pressed: value >= threshold, touched: value > 0, value };
  }
  if (!raw || typeof raw !== "object") return { pressed: false, touched: false, value: 0 };
  const value = clamp(finite(raw.value, raw.pressed ? 1 : 0), 0, 1);
  return {
    pressed: Boolean(raw.pressed) || value >= threshold,
    touched: Boolean(raw.touched) || value > 0,
    value,
  };
}

function normalizeTrigger(value, deadzone) {
  const raw = clamp(finite(value), 0, 1);
  if (raw <= deadzone) return 0;
  return (raw - deadzone) / (1 - deadzone);
}

function resolvedMapping(gamepad, customMapping) {
  const custom = customMapping && typeof customMapping === "object" ? customMapping : {};
  return {
    axes: { ...STANDARD_AXES, ...(custom.axes || {}) },
    buttons: { ...STANDARD_BUTTONS, ...(custom.buttons || {}) },
  };
}

/**
 * Normalize a standard-mapped controller, or safely fall back to conventional
 * positional indices for a generic controller. Supply `genericMapping` to fix
 * a device-specific non-standard layout without branching in gameplay code.
 */
export function readGamepadState(gamepad, options = {}) {
  const family = identifyGamepadFamily(gamepad);
  const buttonFamily = options.layout === "nintendo"
    ? "nintendo"
    : options.layout === "standard"
      ? (family === "playstation" ? "playstation" : "xbox")
      : family;
  const layout = getConfirmBackButtons(buttonFamily);
  const mapping = resolvedMapping(gamepad, options.genericMapping);
  const threshold = clamp(finite(options.buttonThreshold, GAMEPAD_DEFAULTS.buttonThreshold), 0.05, 1);
  const deadzone = clamp(finite(options.deadzone, GAMEPAD_DEFAULTS.deadzone), 0, 0.95);
  const navigationThreshold = clamp(
    finite(options.navigationThreshold, GAMEPAD_DEFAULTS.navigationThreshold),
    0.1,
    1,
  );
  const triggerDeadzone = clamp(
    finite(options.triggerDeadzone, GAMEPAD_DEFAULTS.triggerDeadzone),
    0,
    0.5,
  );
  const axes = safeArray(gamepad?.axes);
  const rawButtons = safeArray(gamepad?.buttons);
  const move = normalizeStick(
    resolveAxis(axes, mapping.axes.moveX),
    resolveAxis(axes, mapping.axes.moveY),
    { deadzone, curve: options.curve },
  );
  const look = normalizeStick(
    resolveAxis(axes, mapping.axes.lookX),
    resolveAxis(axes, mapping.axes.lookY),
    { deadzone, curve: options.curve },
  );
  const mappedButtons = mapping.buttons;
  const confirmIndex = Number.isInteger(mappedButtons.confirm) ? mappedButtons.confirm : layout.confirm;
  const backIndex = Number.isInteger(mappedButtons.back) ? mappedButtons.back : layout.back;
  const primaryIndex = Number.isInteger(mappedButtons.primary) ? mappedButtons.primary : mappedButtons.faceSouth;
  const secondaryIndex = Number.isInteger(mappedButtons.secondary) ? mappedButtons.secondary : mappedButtons.faceWest;
  const specialIndex = Number.isInteger(mappedButtons.special) ? mappedButtons.special : mappedButtons.faceNorth;
  const leftTriggerRaw = readButton(rawButtons, mappedButtons.leftTrigger, threshold);
  const rightTriggerRaw = readButton(rawButtons, mappedButtons.rightTrigger, threshold);
  const leftTrigger = {
    ...leftTriggerRaw,
    value: normalizeTrigger(leftTriggerRaw.value, triggerDeadzone),
  };
  const rightTrigger = {
    ...rightTriggerRaw,
    value: normalizeTrigger(rightTriggerRaw.value, triggerDeadzone),
  };
  leftTrigger.pressed = leftTriggerRaw.pressed || leftTrigger.value >= threshold;
  rightTrigger.pressed = rightTriggerRaw.pressed || rightTrigger.value >= threshold;
  const dpad = {
    up: readButton(rawButtons, mappedButtons.up, threshold).pressed,
    down: readButton(rawButtons, mappedButtons.down, threshold).pressed,
    left: readButton(rawButtons, mappedButtons.left, threshold).pressed,
    right: readButton(rawButtons, mappedButtons.right, threshold).pressed,
  };
  let navigationX = (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  let navigationY = (dpad.down ? 1 : 0) - (dpad.up ? 1 : 0);
  if (navigationX === 0 && navigationY === 0) {
    if (Math.abs(move.x) > Math.abs(move.y)) navigationX = Math.abs(move.x) >= navigationThreshold ? move.x : 0;
    else navigationY = Math.abs(move.y) >= navigationThreshold ? move.y : 0;
  }
  // A single cardinal action per frame avoids double focus jumps when a
  // stick crosses the diagonal or two D-pad contacts overlap briefly.
  if (navigationX && navigationY) {
    if (Math.abs(navigationX) > Math.abs(navigationY)) navigationY = 0;
    else navigationX = 0;
  }
  const buttons = {
    confirm: readButton(rawButtons, confirmIndex, threshold).pressed,
    back: readButton(rawButtons, backIndex, threshold).pressed,
    primary: readButton(rawButtons, primaryIndex, threshold).pressed,
    secondary: readButton(rawButtons, secondaryIndex, threshold).pressed,
    special: readButton(rawButtons, specialIndex, threshold).pressed,
    leftShoulder: readButton(rawButtons, mappedButtons.leftShoulder, threshold).pressed,
    rightShoulder: readButton(rawButtons, mappedButtons.rightShoulder, threshold).pressed,
    brake: leftTrigger.pressed,
    boost: rightTrigger.pressed,
    settings: readButton(rawButtons, mappedButtons.select, threshold).pressed,
    pause: readButton(rawButtons, mappedButtons.pause, threshold).pressed,
    center: readButton(rawButtons, mappedButtons.center, threshold).pressed
      || readButton(rawButtons, mappedButtons.rightStick, threshold).pressed,
    up: dpad.up,
    down: dpad.down,
    left: dpad.left,
    right: dpad.right,
    navUp: navigationY < 0,
    navDown: navigationY > 0,
    navLeft: navigationX < 0,
    navRight: navigationX > 0,
  };
  const normalizedAxes = { moveX: move.x, moveY: move.y, lookX: look.x, lookY: look.y };
  const values = { brake: leftTrigger.value, boost: rightTrigger.value };
  const digitalRoll = (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  const digitalPitch = (dpad.down ? 1 : 0) - (dpad.up ? 1 : 0);
  const flight = {
    // The D-pad is a digital fallback for the left stick during gameplay.
    // A moved stick takes priority so touching the D-pad cannot amplify axes.
    roll: move.x || digitalRoll,
    // Browser axes use -1 for stick-up and +1 for stick-down, matching the
    // existing W/S controller convention used by the flight simulation.
    pitch: move.y || digitalPitch,
    // Face north / face south are the positional Y/A pair on an Xbox pad.
    // Only the aerobatic controller consumes this independent yaw axis.
    yaw: (buttons.primary ? 1 : 0) - (buttons.special ? 1 : 0),
    throttle: rightTrigger.value - leftTrigger.value,
    cameraClimb: look.y === 0 ? 0 : -look.y,
    lookX: look.x,
    lookY: look.y,
  };
  return {
    index: Number.isInteger(gamepad?.index) ? gamepad.index : null,
    id: String(gamepad?.id || "Unknown controller"),
    family,
    mapping: gamepad?.mapping === "standard" ? "standard" : "generic",
    connected: gamepad?.connected !== false,
    timestamp: finite(gamepad?.timestamp),
    axes: normalizedAxes,
    buttons,
    values,
    flight,
    labels: getGamepadButtonLabels(buttonFamily),
    raw: {
      axes: axes.map((value) => finite(value)),
      buttons: rawButtons.map((button) => readButton([button], 0, threshold).value),
    },
  };
}

function centerOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  try {
    const rect = element.getBoundingClientRect();
    const left = finite(rect.left);
    const top = finite(rect.top);
    const width = finite(rect.width, finite(rect.right) - left);
    const height = finite(rect.height, finite(rect.bottom) - top);
    return {
      x: left + width / 2,
      y: top + height / 2,
      left,
      right: finite(rect.right, left + width),
      top,
      bottom: finite(rect.bottom, top + height),
    };
  } catch {
    return null;
  }
}

function usableFocusTarget(element) {
  if (!element || typeof element.focus !== "function") return false;
  if (element.disabled || element.hidden) return false;
  if (typeof element.getAttribute === "function" && element.getAttribute("aria-disabled") === "true") return false;
  if (typeof element.closest === "function"
    && element.closest("[hidden], [inert], [aria-hidden=true], .hidden")) return false;
  const view = element.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
  }
  if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
  return true;
}

/** Select the visually closest focus target in a cardinal direction. */
export function findSpatialNavigationTarget(current, candidates, direction) {
  const list = safeArray(candidates).filter(usableFocusTarget);
  if (!list.length) return null;
  if (!current || !list.includes(current)) return list[0];
  const origin = centerOf(current);
  if (!origin) return list.find((candidate) => candidate !== current) || current;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of list) {
    if (candidate === current) continue;
    const point = centerOf(candidate);
    if (!point) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const primary = direction === "left" ? -dx
      : direction === "right" ? dx
        : direction === "up" ? -dy
          : dy;
    if (primary <= 0.5) continue;
    const perpendicular = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const overlap = direction === "left" || direction === "right"
      ? Math.min(origin.bottom, point.bottom) - Math.max(origin.top, point.top)
      : Math.min(origin.right, point.right) - Math.max(origin.left, point.left);
    const anglePenalty = (perpendicular / primary) * 45;
    const score = primary + perpendicular * 1.8 + anglePenalty - (overlap > 0 ? Math.min(overlap, 30) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function normalizeGamepadPreferences(value = {}, defaults = GAMEPAD_DEFAULTS) {
  const source = value && typeof value === "object" ? value : {};
  const mode = ["auto", "keyboard", "gamepad"].includes(source.mode) ? source.mode : defaults.mode;
  const layout = ["auto", "standard", "nintendo"].includes(source.layout) ? source.layout : defaults.layout;
  return {
    mode,
    layout,
    haptics: typeof source.haptics === "boolean" ? source.haptics : Boolean(defaults.haptics),
    hapticsIntensity: clamp(finite(source.hapticsIntensity, defaults.hapticsIntensity), 0, 1),
    deadzone: clamp(finite(source.deadzone, defaults.deadzone), 0, 0.5),
  };
}

export function loadGamepadPreferences(storage, key = GAMEPAD_DEFAULTS.storageKey, defaults = GAMEPAD_DEFAULTS) {
  if (!storage || typeof storage.getItem !== "function") return normalizeGamepadPreferences({}, defaults);
  try {
    const stored = storage.getItem(key);
    return normalizeGamepadPreferences(stored ? JSON.parse(stored) : {}, defaults);
  } catch {
    return normalizeGamepadPreferences({}, defaults);
  }
}

export function saveGamepadPreferences(storage, preferences, key = GAMEPAD_DEFAULTS.storageKey) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeGamepadPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

function describeGamepad(gamepad) {
  const family = identifyGamepadFamily(gamepad);
  const actuators = [gamepad?.vibrationActuator, ...safeArray(gamepad?.hapticActuators)].filter(Boolean);
  return {
    index: Number.isInteger(gamepad?.index) ? gamepad.index : null,
    id: String(gamepad?.id || "Unknown controller"),
    family,
    mapping: gamepad?.mapping === "standard" ? "standard" : "generic",
    connected: gamepad?.connected !== false,
    haptics: actuators.some((actuator) => (
      typeof actuator.playEffect === "function" || typeof actuator.pulse === "function"
    )),
    labels: getGamepadButtonLabels(family),
  };
}

function neutralState(descriptor = {}) {
  return {
    index: descriptor.index ?? null,
    id: descriptor.id || "",
    family: descriptor.family || "generic",
    mapping: descriptor.mapping || "generic",
    connected: descriptor.connected !== false,
    timestamp: 0,
    axes: EMPTY_AXES,
    buttons: EMPTY_BUTTONS,
    values: EMPTY_VALUES,
    flight: EMPTY_FLIGHT,
    labels: descriptor.labels || getGamepadButtonLabels(descriptor.family || "generic"),
    raw: { axes: [], buttons: [] },
  };
}

function stateHasActivity(state, threshold) {
  if (!state) return false;
  if (ACTION_BUTTONS.some((action) => Boolean(state.buttons[action]))) return true;
  return Math.hypot(state.axes.moveX, state.axes.moveY) >= threshold
    || Math.hypot(state.axes.lookX, state.axes.lookY) >= threshold;
}

function stateChangedMeaningfully(previous, current) {
  if (!previous) return stateHasActivity(current, GAMEPAD_DEFAULTS.activityThreshold);
  for (const action of ACTION_BUTTONS) {
    if (Boolean(previous.buttons[action]) !== Boolean(current.buttons[action])) return true;
  }
  for (const name of ["moveX", "moveY", "lookX", "lookY"]) {
    if (Math.abs(finite(current.axes[name]) - finite(previous.axes[name])) > 0.035
      && Math.max(Math.abs(finite(current.axes[name])), Math.abs(finite(previous.axes[name]))) > 0.08) return true;
  }
  if (Math.abs(current.values.brake - previous.values.brake) > 0.05) return true;
  return Math.abs(current.values.boost - previous.values.boost) > 0.05;
}

function safeQuery(documentTarget, selectors) {
  if (!documentTarget || typeof documentTarget.querySelector !== "function") return null;
  for (const selector of selectors) {
    try {
      const result = documentTarget.querySelector(selector);
      if (result) return result;
    } catch {
      // A host page may not implement the entire selector grammar.
    }
  }
  return null;
}

function setAttribute(element, name, value) {
  if (element && typeof element.setAttribute === "function") element.setAttribute(name, String(value));
}

function rawGamepads(navigatorTarget) {
  if (!navigatorTarget || typeof navigatorTarget.getGamepads !== "function") return null;
  try {
    return safeArray(navigatorTarget.getGamepads());
  } catch {
    return null;
  }
}

/**
 * Polling manager. Construction has no global side effects; call `start()` for
 * event listeners + requestAnimationFrame, or call `poll(now)` from the game's
 * existing render loop. `dispose()` removes everything installed by `start()`.
 */
export class GamepadControls {
  constructor(options = {}) {
    this.navigatorTarget = options.navigatorTarget ?? (typeof navigator !== "undefined" ? navigator : null);
    this.windowTarget = options.windowTarget ?? (typeof window !== "undefined" ? window : null);
    this.documentTarget = options.documentTarget ?? (typeof document !== "undefined" ? document : null);
    this.storage = options.storage ?? this.windowTarget?.localStorage ?? null;
    this.storageKey = options.storageKey || GAMEPAD_DEFAULTS.storageKey;
    this.genericMappings = options.genericMappings || {};
    this.onAction = typeof options.onAction === "function" ? options.onAction : null;
    this.onSnapshot = typeof options.onSnapshot === "function" ? options.onSnapshot : null;
    this.onDevicesChange = typeof options.onDevicesChange === "function" ? options.onDevicesChange : null;
    this.onInputSourceChange = typeof options.onInputSourceChange === "function" ? options.onInputSourceChange : null;
    this.onUiSync = typeof options.onUiSync === "function" ? options.onUiSync : null;
    this.getFocusableElements = typeof options.getFocusableElements === "function"
      ? options.getFocusableElements
      : null;
    this.shouldNavigateFocus = typeof options.shouldNavigateFocus === "function"
      ? options.shouldNavigateFocus
      : null;
    this.focusSelector = options.focusSelector || GAMEPAD_DEFAULTS.focusSelector;
    this.rovingTabindex = options.rovingTabindex === true;
    this.autoFocusNavigation = options.autoFocusNavigation !== false;
    this.autoActivate = options.autoActivate !== false;
    this.autoHaptics = options.autoHaptics !== false;
    this.repeatDelay = Math.max(0, finite(options.repeatDelay, GAMEPAD_DEFAULTS.repeatDelay));
    this.repeatInterval = Math.max(16, finite(options.repeatInterval, GAMEPAD_DEFAULTS.repeatInterval));
    this.buttonThreshold = clamp(finite(options.buttonThreshold, GAMEPAD_DEFAULTS.buttonThreshold), 0.05, 1);
    this.activityThreshold = clamp(finite(options.activityThreshold, GAMEPAD_DEFAULTS.activityThreshold), 0.05, 1);
    this.navigationThreshold = clamp(
      finite(options.navigationThreshold, GAMEPAD_DEFAULTS.navigationThreshold),
      0.1,
      1,
    );
    this.triggerDeadzone = clamp(
      finite(options.triggerDeadzone, GAMEPAD_DEFAULTS.triggerDeadzone),
      0,
      0.5,
    );
    const initial = normalizeGamepadPreferences(options.preferences || {});
    this.preferences = loadGamepadPreferences(this.storage, this.storageKey, initial);
    this.inputSource = this.preferences.mode === "gamepad" ? "gamepad" : "keyboard";
    this.records = new Map();
    this.activeIndex = null;
    this.justPressedActions = new Set();
    this.justReleasedActions = new Set();
    this.heldNavigation = new Map();
    this.running = false;
    this.suspended = Boolean(this.documentTarget?.hidden);
    this.frameHandle = null;
    this.listeners = [];
    this.lastDeviceFingerprint = "";
    this.lastPollTime = 0;
    this.snapshot = this._composeSnapshot(null, 0);
    this.now = typeof options.now === "function"
      ? options.now
      : () => finite(this.windowTarget?.performance?.now?.(), Date.now());
    this.requestFrame = options.requestFrame
      || (typeof this.windowTarget?.requestAnimationFrame === "function"
        ? this.windowTarget.requestAnimationFrame.bind(this.windowTarget)
        : null);
    this.cancelFrame = options.cancelFrame
      || (typeof this.windowTarget?.cancelAnimationFrame === "function"
        ? this.windowTarget.cancelAnimationFrame.bind(this.windowTarget)
        : null);
    this.elements = this._resolveElements(options.elements || options.ui || {});
    this.boundFrame = (time) => {
      this.frameHandle = null;
      if (!this.running || this.suspended) return;
      this.poll(time);
      this._scheduleFrame();
    };
    this.boundConnected = (event) => this._registerGamepad(event?.gamepad, this.now());
    this.boundDisconnected = (event) => this._removeGamepad(event?.gamepad?.index, event?.gamepad);
    this.boundBlur = () => this.suspend();
    this.boundFocus = () => {
      if (!this.documentTarget?.hidden) this.resume();
    };
    this.boundVisibility = () => {
      if (this.documentTarget?.hidden) this.suspend();
      else this.resume();
    };
    this.syncUi();
    if (options.autoStart) this.start();
  }

  _resolveElements(explicit) {
    const pick = (name, selectors) => explicit[name] || safeQuery(this.documentTarget, selectors);
    return {
      keyboardMode: pick("keyboardMode", ["#input-keyboard", "#control-method-keyboard", "[data-control-method=keyboard]"]),
      gamepadMode: pick("gamepadMode", ["#input-gamepad", "#control-method-gamepad", "[data-control-method=gamepad]"]),
      mode: pick("mode", ["[data-gamepad-mode]"]),
      panel: pick("panel", ["#gamepad-panel", "[data-gamepad-panel]"]),
      deviceList: pick("deviceList", ["#gamepad-list", "#gamepad-device-list", "[data-gamepad-device-list]"]),
      status: pick("status", ["#gamepad-status", "[data-gamepad-status]"]),
      layout: pick("layout", ["#gamepad-layout", "[data-gamepad-layout]"]),
      haptics: pick("haptics", ["#gamepad-vibration", "[data-gamepad-haptics]"]),
      hapticsIntensity: pick("hapticsIntensity", ["#gamepad-vibration-strength", "[data-gamepad-haptics-intensity]"]),
      hapticsOutput: pick("hapticsOutput", ["#gamepad-vibration-value", "[data-gamepad-haptics-output]"]),
      hapticsTest: pick("hapticsTest", ["#gamepad-vibration-test", "[data-gamepad-haptics-test]"]),
      deadzone: pick("deadzone", ["#gamepad-deadzone", "[data-gamepad-deadzone]"]),
      deadzoneOutput: pick("deadzoneOutput", ["#gamepad-deadzone-value", "[data-gamepad-deadzone-output]"]),
      mappingHelp: pick("mappingHelp", ["#gamepad-map", "[data-gamepad-map]"]),
      focusRoot: pick("focusRoot", ["[data-gamepad-focus-root]"]),
    };
  }

  _listen(target, type, listener) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, listener);
    this.listeners.push(() => target.removeEventListener?.(type, listener));
  }

  _bindUi() {
    this._listen(this.elements.keyboardMode, "click", () => this.setMode("keyboard"));
    this._listen(this.elements.gamepadMode, "click", () => this.setMode("gamepad"));
    this._listen(this.elements.mode, "change", (event) => this.setMode(event?.target?.value));
    this._listen(this.elements.layout, "change", (event) => this.setLayout(event?.target?.value));
    this._listen(this.elements.haptics, "change", (event) => this.setHapticsEnabled(Boolean(event?.target?.checked)));
    const updateDeadzone = (event) => {
      const raw = Number(event?.target?.value);
      this.setDeadzone(raw > 1 ? raw / 100 : raw);
    };
    const updateHapticsIntensity = (event) => {
      const raw = Number(event?.target?.value);
      this.setHapticsIntensity(raw > 1 ? raw / 100 : raw);
    };
    this._listen(this.elements.deadzone, "input", updateDeadzone);
    this._listen(this.elements.deadzone, "change", updateDeadzone);
    this._listen(this.elements.hapticsIntensity, "input", updateHapticsIntensity);
    this._listen(this.elements.hapticsIntensity, "change", updateHapticsIntensity);
    this._listen(this.elements.hapticsTest, "click", () => {
      void this.vibrate({ duration: 180, weakMagnitude: 0.55, strongMagnitude: 0.8 });
    });
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this._listen(this.windowTarget, "gamepadconnected", this.boundConnected);
    this._listen(this.windowTarget, "gamepaddisconnected", this.boundDisconnected);
    this._listen(this.windowTarget, "blur", this.boundBlur);
    this._listen(this.windowTarget, "focus", this.boundFocus);
    this._listen(this.documentTarget, "visibilitychange", this.boundVisibility);
    this._bindUi();
    this.poll(this.now());
    this._scheduleFrame();
    return this;
  }

  stop() {
    this.running = false;
    if (this.frameHandle != null && this.cancelFrame) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    while (this.listeners.length) this.listeners.pop()();
    this._clearTransientInput(true);
    void this.stopVibration();
    return this;
  }

  dispose() {
    this.stop();
    this.records.clear();
    this.activeIndex = null;
    this.snapshot = this._composeSnapshot(null, this.lastPollTime);
    this._notifyDevicesChanged(true);
  }

  _scheduleFrame() {
    if (!this.running || this.suspended || this.frameHandle != null || !this.requestFrame) return;
    this.frameHandle = this.requestFrame(this.boundFrame);
  }

  _mappingFor(gamepad) {
    if (typeof this.genericMappings === "function") return this.genericMappings(gamepad) || null;
    if (!this.genericMappings || typeof this.genericMappings !== "object") return null;
    const family = identifyGamepadFamily(gamepad);
    return this.genericMappings[gamepad?.id]
      || this.genericMappings[family]
      || this.genericMappings.default
      || null;
  }

  _read(gamepad) {
    return readGamepadState(gamepad, {
      deadzone: this.preferences.deadzone,
      layout: this.preferences.layout,
      buttonThreshold: this.buttonThreshold,
      navigationThreshold: this.navigationThreshold,
      triggerDeadzone: this.triggerDeadzone,
      genericMapping: gamepad?.mapping === "standard" ? null : this._mappingFor(gamepad),
    });
  }

  _registerGamepad(gamepad, time = this.now()) {
    if (!gamepad || !Number.isInteger(gamepad.index) || gamepad.connected === false) return null;
    let record = this.records.get(gamepad.index);
    if (record) {
      record.gamepad = gamepad;
      record.descriptor = describeGamepad(gamepad);
      return record;
    }
    const descriptor = describeGamepad(gamepad);
    record = {
      gamepad,
      descriptor,
      previous: neutralState(descriptor),
      current: neutralState(descriptor),
      firstGestureConsumed: false,
      waitingForNeutral: false,
      blockedThisPoll: false,
      activityThisPoll: false,
      lastActivity: Number.NEGATIVE_INFINITY,
      connectedAt: time,
    };
    this.records.set(gamepad.index, record);
    this._notifyDevicesChanged(true);
    return record;
  }

  _removeGamepad(index, fallbackGamepad = null) {
    if (!Number.isInteger(index)) return;
    const record = this.records.get(index);
    if (!record) return;
    void this._stopRawGamepad(record.gamepad || fallbackGamepad);
    this.records.delete(index);
    if (this.activeIndex === index) {
      this.activeIndex = null;
      this._selectMostRecentController();
      this._clearTransientInput(true);
    }
    this._notifyDevicesChanged(true);
  }

  _selectMostRecentController() {
    let selected = null;
    for (const record of this.records.values()) {
      if (!record.firstGestureConsumed) continue;
      if (!selected || record.lastActivity > selected.lastActivity) selected = record;
    }
    this.activeIndex = selected?.descriptor.index ?? null;
    return selected;
  }

  poll(time = this.now()) {
    const timestamp = finite(time, this.now());
    this.lastPollTime = timestamp;
    this.justPressedActions.clear();
    this.justReleasedActions.clear();
    const pads = rawGamepads(this.navigatorTarget);
    const seen = new Set();

    if (pads) {
      for (const gamepad of pads) {
        if (!gamepad || gamepad.connected === false || !Number.isInteger(gamepad.index)) continue;
        seen.add(gamepad.index);
        const record = this._registerGamepad(gamepad, timestamp);
        record.gamepad = gamepad;
        record.descriptor = describeGamepad(gamepad);
        record.current = this._read(gamepad);
        record.blockedThisPoll = false;
        record.activityThisPoll = false;

        const hasActivity = stateHasActivity(record.current, this.activityThreshold);
        if (!record.firstGestureConsumed) {
          if (hasActivity) {
            // Privacy-gated browsers often reveal a pad on its first button
            // press. Consume that gesture so it can never click lobby UI.
            record.firstGestureConsumed = true;
            record.waitingForNeutral = true;
            record.lastActivity = timestamp;
            this.activeIndex = gamepad.index;
          }
          record.blockedThisPoll = true;
        } else if (record.waitingForNeutral) {
          record.blockedThisPoll = true;
          if (!hasActivity) record.waitingForNeutral = false;
        } else if (stateChangedMeaningfully(record.previous, record.current)) {
          record.lastActivity = timestamp;
          record.activityThisPoll = true;
        }
      }

      if (!this.suspended) {
        for (const index of Array.from(this.records.keys())) {
          if (!seen.has(index)) this._removeGamepad(index);
        }
      }
    }

    const selected = this._selectMostRecentController();
    if (selected?.activityThisPoll && !selected.blockedThisPoll && !this.suspended && this.preferences.mode !== "keyboard") {
      this._setInputSource("gamepad");
    }
    const acceptsGamepad = !this.suspended
      && this.preferences.mode !== "keyboard"
      && (this.preferences.mode === "gamepad" || this.inputSource === "gamepad");
    if (selected && acceptsGamepad && !selected.blockedThisPoll) {
      this._processActions(selected, timestamp);
      this.snapshot = this._composeSnapshot(selected.current, timestamp);
    } else {
      this._resetNavigationRepeat();
      this.snapshot = this._composeSnapshot(null, timestamp);
    }

    for (const record of this.records.values()) {
      record.previous = record.current;
      record.blockedThisPoll = false;
      record.activityThisPoll = false;
    }
    this._notifyDevicesChanged(false);
    this.onSnapshot?.(this.snapshot);
    return this.snapshot;
  }

  _processActions(record, time) {
    const previous = record.previous || neutralState(record.descriptor);
    const current = record.current;
    for (const action of ACTION_BUTTONS) {
      const wasPressed = Boolean(previous.buttons[action]);
      const isPressed = Boolean(current.buttons[action]);
      if (!wasPressed && isPressed) {
        this.justPressedActions.add(action);
        this._emitAction(action, "pressed", record, time, false);
      } else if (wasPressed && !isPressed) {
        this.justReleasedActions.add(action);
        this._emitAction(action, "released", record, time, false);
      }
    }
    this._processNavigationRepeat(record, time);
  }

  _processNavigationRepeat(record, time) {
    for (const [action, direction] of Object.entries(NAVIGATION_ACTIONS)) {
      const held = Boolean(record.current.buttons[action]);
      let repeat = this.heldNavigation.get(action);
      if (!held) {
        this.heldNavigation.delete(action);
        continue;
      }
      if (!repeat) {
        this.heldNavigation.set(action, { since: time, last: time });
        continue;
      }
      if (time - repeat.since < this.repeatDelay || time - repeat.last < this.repeatInterval) continue;
      repeat.last = time;
      this._emitAction(action, "repeat", record, time, true, direction);
    }
  }

  _emitAction(action, phase, record, time, repeated, knownDirection = null) {
    const direction = knownDirection || NAVIGATION_ACTIONS[action] || null;
    let focusTarget = null;
    if (phase !== "released" && direction && this.autoFocusNavigation
        && this.shouldNavigateFocus?.(action, record.current) !== false) {
      focusTarget = this.navigateFocus(direction);
    } else if (phase === "pressed" && action === "confirm" && this.autoActivate) {
      focusTarget = this.activateFocusedElement();
    }
    const detail = {
      action,
      phase,
      repeated,
      timestamp: time,
      gamepad: record.descriptor,
      snapshot: record.current,
      focusTarget,
    };
    this.onAction?.(action, detail);
    if (phase === "pressed" && this.autoHaptics) {
      const pattern = direction ? "navigation" : action === "back" ? "back" : action === "confirm" ? "confirm" : null;
      if (pattern) void this.vibrate(pattern).catch(() => false);
    }
  }

  _focusCandidates() {
    if (this.getFocusableElements) {
      try {
        return safeArray(this.getFocusableElements()).filter(usableFocusTarget);
      } catch {
        return [];
      }
    }
    const root = this.elements.focusRoot || this.documentTarget;
    if (!root || typeof root.querySelectorAll !== "function") return [];
    try {
      return safeArray(root.querySelectorAll(this.focusSelector)).filter(usableFocusTarget);
    } catch {
      return [];
    }
  }

  _explicitNavigationTarget(current, direction, candidates) {
    const suffix = direction[0].toUpperCase() + direction.slice(1);
    const selector = current?.dataset?.[`gamepadNav${suffix}`] || current?.dataset?.[`nav${suffix}`];
    if (!selector) return null;
    let target = null;
    try {
      target = selector.startsWith("#") && typeof this.documentTarget?.getElementById === "function"
        ? this.documentTarget.getElementById(selector.slice(1))
        : this.documentTarget?.querySelector?.(selector);
    } catch {
      return null;
    }
    return candidates.includes(target) && usableFocusTarget(target) ? target : null;
  }

  _focusElement(target, candidates) {
    if (!usableFocusTarget(target)) return null;
    if (this.rovingTabindex) {
      for (const candidate of candidates) setAttribute(candidate, "tabindex", candidate === target ? 0 : -1);
    }
    try {
      target.focus({ preventScroll: true });
    } catch {
      try {
        target.focus();
      } catch {
        return null;
      }
    }
    try {
      target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } catch {
      // Focus is still valid when scrolling is unsupported.
    }
    return target;
  }

  navigateFocus(direction) {
    if (!["up", "down", "left", "right"].includes(direction)) return null;
    const candidates = this._focusCandidates();
    if (!candidates.length) return null;
    const current = this.documentTarget?.activeElement;
    if ((direction === "left" || direction === "right") && candidates.includes(current)) {
      let changed = false;
      if (current?.matches?.('input[type="range"]')) {
        if (direction === "right") current.stepUp?.();
        else current.stepDown?.();
        changed = true;
      } else if (current?.matches?.("select") && current.options?.length) {
        const delta = direction === "right" ? 1 : -1;
        const next = clamp(current.selectedIndex + delta, 0, current.options.length - 1);
        changed = next !== current.selectedIndex;
        current.selectedIndex = next;
      }
      if (changed) {
        const EventConstructor = this.windowTarget?.Event;
        if (typeof EventConstructor === "function") {
          current.dispatchEvent?.(new EventConstructor("input", { bubbles: true }));
          current.dispatchEvent?.(new EventConstructor("change", { bubbles: true }));
        }
        return this._focusElement(current, candidates);
      }
    }
    const explicit = this._explicitNavigationTarget(current, direction, candidates);
    const target = explicit || findSpatialNavigationTarget(current, candidates, direction);
    return this._focusElement(target, candidates);
  }

  activateFocusedElement() {
    const candidates = this._focusCandidates();
    if (!candidates.length) return null;
    let target = this.documentTarget?.activeElement;
    if (!candidates.includes(target) || !usableFocusTarget(target)) target = this._focusElement(candidates[0], candidates);
    if (!target) return null;
    if (typeof target.click === "function") target.click();
    return target;
  }

  _composeSnapshot(state, time) {
    const active = state || neutralState(this.records.get(this.activeIndex)?.descriptor);
    return {
      connected: this.records.size > 0,
      devices: this.devices,
      activeIndex: this.activeIndex,
      activeId: this.records.get(this.activeIndex)?.descriptor.id || null,
      inputSource: this.inputSource,
      axes: state ? active.axes : EMPTY_AXES,
      buttons: state ? active.buttons : EMPTY_BUTTONS,
      values: state ? active.values : EMPTY_VALUES,
      flight: state ? active.flight : EMPTY_FLIGHT,
      edges: {
        pressed: Array.from(this.justPressedActions),
        released: Array.from(this.justReleasedActions),
      },
      timestamp: time,
    };
  }

  _setInputSource(source) {
    if (source !== "keyboard" && source !== "gamepad") return;
    if (this.inputSource === source) return;
    this.inputSource = source;
    this.onInputSourceChange?.(source);
    this.syncUi();
  }

  notifyKeyboardActivity() {
    if (this.preferences.mode !== "auto") return;
    this._setInputSource("keyboard");
    this._requireNeutral();
    this._clearTransientInput(false);
  }

  _requireNeutral() {
    for (const record of this.records.values()) {
      if (record.firstGestureConsumed) {
        record.waitingForNeutral = true;
        record.blockedThisPoll = true;
      }
    }
  }

  _clearTransientInput(requireNeutral) {
    if (requireNeutral) this._requireNeutral();
    this.justPressedActions.clear();
    this.justReleasedActions.clear();
    this._resetNavigationRepeat();
    this.snapshot = this._composeSnapshot(null, this.lastPollTime);
    this.onSnapshot?.(this.snapshot);
  }

  _resetNavigationRepeat() {
    this.heldNavigation.clear();
  }

  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    if (this.frameHandle != null && this.cancelFrame) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this._clearTransientInput(true);
    void this.stopVibration();
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this._requireNeutral();
    this._scheduleFrame();
  }

  justPressed(action) {
    return this.justPressedActions.has(action);
  }

  justReleased(action) {
    return this.justReleasedActions.has(action);
  }

  isActionPressed(action, { fresh = true } = {}) {
    if (!action) return false;
    if (!fresh) return Boolean(this.snapshot?.buttons?.[action]);
    const pads = rawGamepads(this.navigatorTarget);
    const active = pads?.find?.((gamepad) => gamepad?.index === this.activeIndex)
      || pads?.find?.((gamepad) => gamepad && gamepad.connected !== false);
    if (!active) return false;
    return Boolean(this._read(active).buttons?.[action]);
  }

  get devices() {
    return Array.from(this.records.values())
      .map((record) => ({ ...record.descriptor }))
      .sort((left, right) => left.index - right.index);
  }

  get activeGamepad() {
    return this.records.get(this.activeIndex)?.gamepad || null;
  }

  getPreferences() {
    return { ...this.preferences };
  }

  setPreferences(patch = {}) {
    const next = normalizeGamepadPreferences({ ...this.preferences, ...patch });
    const deadzoneChanged = next.deadzone !== this.preferences.deadzone;
    const modeChanged = next.mode !== this.preferences.mode;
    const layoutChanged = next.layout !== this.preferences.layout;
    this.preferences = next;
    if (next.mode === "keyboard") this._setInputSource("keyboard");
    else if (next.mode === "gamepad") this._setInputSource("gamepad");
    if (deadzoneChanged || modeChanged || layoutChanged) this._clearTransientInput(true);
    saveGamepadPreferences(this.storage, this.preferences, this.storageKey);
    this.syncUi();
    return this.getPreferences();
  }

  setMode(mode) {
    if (!["auto", "keyboard", "gamepad"].includes(mode)) return this.getPreferences();
    return this.setPreferences({ mode });
  }

  setLayout(layout) {
    if (!["auto", "standard", "nintendo"].includes(layout)) return this.getPreferences();
    return this.setPreferences({ layout });
  }

  setHapticsEnabled(enabled) {
    if (!enabled) void this.stopVibration();
    return this.setPreferences({ haptics: Boolean(enabled) });
  }

  setHapticsIntensity(intensity) {
    return this.setPreferences({ hapticsIntensity: intensity });
  }

  setDeadzone(deadzone) {
    if (!Number.isFinite(deadzone)) return this.getPreferences();
    return this.setPreferences({ deadzone });
  }

  syncUi() {
    const {
      keyboardMode,
      gamepadMode,
      mode,
      panel,
      deviceList,
      status,
      layout,
      haptics,
      hapticsIntensity,
      hapticsOutput,
      hapticsTest,
      deadzone,
      deadzoneOutput,
      mappingHelp,
    } = this.elements;
    const selectedMode = this.preferences.mode;
    const keyboardActive = selectedMode === "keyboard" || (selectedMode === "auto" && this.inputSource === "keyboard");
    const gamepadActive = selectedMode === "gamepad" || (selectedMode === "auto" && this.inputSource === "gamepad");
    setAttribute(keyboardMode, "aria-pressed", keyboardActive);
    setAttribute(gamepadMode, "aria-pressed", gamepadActive);
    if (keyboardMode && "checked" in keyboardMode) keyboardMode.checked = selectedMode === "keyboard";
    if (gamepadMode && "checked" in gamepadMode) gamepadMode.checked = selectedMode === "gamepad";
    setAttribute(gamepadMode, "aria-expanded", gamepadActive);
    if (mode && "value" in mode) mode.value = selectedMode;
    if (panel && "hidden" in panel) panel.hidden = !gamepadActive;
    if (layout && "value" in layout) layout.value = this.preferences.layout;
    if (haptics && "checked" in haptics) haptics.checked = this.preferences.haptics;
    const deadzonePercent = Math.round(this.preferences.deadzone * 100);
    const hapticsPercent = Math.round(this.preferences.hapticsIntensity * 100);
    if (deadzone && "value" in deadzone) deadzone.value = String(deadzonePercent);
    if (deadzoneOutput && "textContent" in deadzoneOutput) deadzoneOutput.textContent = `${deadzonePercent}%`;
    if (hapticsIntensity && "value" in hapticsIntensity) hapticsIntensity.value = String(hapticsPercent);
    if (hapticsOutput && "textContent" in hapticsOutput) hapticsOutput.textContent = `${hapticsPercent}%`;
    const active = this.records.get(this.activeIndex)?.descriptor;
    if (hapticsTest && "disabled" in hapticsTest) {
      hapticsTest.disabled = !active?.haptics || !this.preferences.haptics || hapticsPercent === 0;
    }
    if (deviceList) {
      const children = this.devices.map((device) => {
        const item = this.documentTarget?.createElement?.("li");
        if (!item) return null;
        item.classList.toggle("active", device.index === this.activeIndex);
        item.dataset.gamepadIndex = String(device.index);
        const name = this.documentTarget.createElement("span");
        name.className = "gamepad-device-name";
        name.textContent = device.id;
        const meta = this.documentTarget.createElement("span");
        meta.className = "gamepad-device-meta";
        meta.textContent = `${device.mapping === "standard" ? "Standard" : "Generic"}${device.haptics ? " · vibration" : ""}`;
        item.append(name, meta);
        return item;
      }).filter(Boolean);
      if (typeof deviceList.replaceChildren === "function") deviceList.replaceChildren(...children);
      else if ("textContent" in deviceList) deviceList.textContent = this.devices.map((device) => device.id).join(" · ");
      setAttribute(deviceList, "data-controller-count", this.records.size);
    }
    if (status) {
      const text = !this.navigatorTarget || typeof this.navigatorTarget.getGamepads !== "function"
        ? "This browser does not expose the Gamepad API. Keyboard controls remain available."
        : !this.records.size
          ? "Connect or pair a controller, then press any button or move a stick."
          : active
            ? `${this.records.size} controller${this.records.size === 1 ? "" : "s"} detected. Active: ${active.id}.`
            : `${this.records.size} controller${this.records.size === 1 ? "" : "s"} detected`;
      if ("textContent" in status) status.textContent = text;
      setAttribute(status, "data-gamepad-state", active ? "active" : this.records.size ? "connected" : "waiting");
      status.classList?.toggle("connected", Boolean(active));
      status.classList?.toggle("warning", Boolean(active && active.mapping !== "standard"));
    }
    const labelFamily = this.preferences.layout === "nintendo"
      ? "nintendo"
      : this.preferences.layout === "standard"
        ? (active?.family === "playstation" ? "playstation" : "xbox")
        : (active?.family || "generic");
    const labels = getGamepadButtonLabels(labelFamily);
    if (mappingHelp && "textContent" in mappingHelp) {
      mappingHelp.textContent = `Left stick/D-pad steer and navigate · right stick camera · triggers change speed · ${labels.leftShoulder} hold voice chat · ${labels.rightShoulder} Street View · ${labels.faceNorth}/${labels.faceSouth} aerobatic rudder · ${labels.confirm} confirm/action · ${labels.back} back · ${labels.faceWest} secondary/smoke/contrails · ${labels.rightStick} center view · ${labels.select} settings · ${labels.pause} pause. Return to the game window to leave external Street View. System/Home stays reserved for the device or browser.`;
    }
    const body = this.documentTarget?.body;
    body?.classList?.toggle("input-gamepad", gamepadActive);
    body?.classList?.toggle("gamepad-navigation", gamepadActive && Boolean(active));
    const gamepadHint = this.documentTarget?.getElementById?.("vehicle-controls-gamepad");
    if (gamepadHint && "hidden" in gamepadHint) gamepadHint.hidden = !gamepadActive;
    const state = {
      preferences: this.getPreferences(),
      inputSource: this.inputSource,
      devices: this.devices,
      activeIndex: this.activeIndex,
    };
    this.onUiSync?.(state);
    return state;
  }

  _notifyDevicesChanged(force) {
    const fingerprint = JSON.stringify({
      activeIndex: this.activeIndex,
      devices: this.devices.map(({ index, id, family, mapping, connected, haptics }) => ({
        index,
        id,
        family,
        mapping,
        connected,
        haptics,
      })),
    });
    if (!force && fingerprint === this.lastDeviceFingerprint) return;
    this.lastDeviceFingerprint = fingerprint;
    this.syncUi();
    this.onDevicesChange?.(this.devices, this.activeIndex);
  }

  _hapticPattern(pattern) {
    const source = typeof pattern === "string" ? GAMEPAD_HAPTIC_PATTERNS[pattern] : pattern;
    const value = source && typeof source === "object" ? source : GAMEPAD_HAPTIC_PATTERNS.confirm;
    const intensity = this.preferences.hapticsIntensity;
    return {
      startDelay: Math.max(0, finite(value.startDelay)),
      duration: clamp(finite(value.duration, 40), 0, 5000),
      weakMagnitude: clamp(finite(value.weakMagnitude, finite(value.weak, 0.25)) * intensity, 0, 1),
      strongMagnitude: clamp(finite(value.strongMagnitude, finite(value.strong, 0.25)) * intensity, 0, 1),
    };
  }

  async vibrate(pattern = "confirm", index = this.activeIndex) {
    const gamepadIsSelected = this.preferences.mode === "gamepad"
      || (this.preferences.mode === "auto" && this.inputSource === "gamepad");
    if (!gamepadIsSelected || !this.preferences.haptics || this.suspended || !Number.isInteger(index)) return false;
    const gamepad = this.records.get(index)?.gamepad;
    if (!gamepad) return false;
    const effect = this._hapticPattern(pattern);
    const actuators = [gamepad.vibrationActuator, ...safeArray(gamepad.hapticActuators)].filter(Boolean);
    const effectActuator = actuators.find((candidate) => typeof candidate.playEffect === "function");
    if (effectActuator) {
      const effects = safeArray(effectActuator.effects);
      if (!effects.length || effects.includes("dual-rumble")) {
        try {
          await effectActuator.playEffect("dual-rumble", effect);
          return true;
        } catch {
          // Some implementations expose the modern surface but reject an
          // effect; try their legacy pulse actuator before giving up.
        }
      }
    }
    const pulseActuator = actuators.find((candidate) => typeof candidate.pulse === "function");
    if (!pulseActuator) return false;
    try {
      await pulseActuator.pulse(Math.max(effect.weakMagnitude, effect.strongMagnitude), effect.duration);
      return true;
    } catch {
      return false;
    }
  }

  async _stopRawGamepad(gamepad) {
    if (!gamepad) return false;
    const actuators = [gamepad.vibrationActuator, ...safeArray(gamepad.hapticActuators)].filter(Boolean);
    let stopped = false;
    for (const actuator of new Set(actuators)) {
      let actuatorStopped = false;
      try {
        if (typeof actuator.reset === "function") {
          await actuator.reset();
          actuatorStopped = true;
        }
      } catch {
        // Fall through to the other supported stop mechanisms.
      }
      if (!actuatorStopped && typeof actuator.playEffect === "function") {
        try {
          await actuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration: 0,
            weakMagnitude: 0,
            strongMagnitude: 0,
          });
          actuatorStopped = true;
        } catch {
          // Some legacy actuators expose playEffect but only implement pulse.
        }
      }
      if (!actuatorStopped && typeof actuator.pulse === "function") {
        try {
          await actuator.pulse(0, 0);
          actuatorStopped = true;
        } catch {
          // Disconnecting hardware commonly rejects best-effort stop calls.
        }
      }
      stopped ||= actuatorStopped;
    }
    return stopped;
  }

  async stopVibration(index = null) {
    if (Number.isInteger(index)) return this._stopRawGamepad(this.records.get(index)?.gamepad);
    const results = await Promise.all(Array.from(this.records.values(), (record) => this._stopRawGamepad(record.gamepad)));
    return results.some(Boolean);
  }
}

export function createGamepadController(options = {}) {
  return new GamepadControls(options);
}

export const createGamepadControls = createGamepadController;

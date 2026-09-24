export const GAMEPAD_KEYBOARD_ROWS = Object.freeze([
  Object.freeze(Array.from("1234567890")),
  Object.freeze(Array.from("QWERTYUIOP")),
  Object.freeze(Array.from("ASDFGHJKL")),
  Object.freeze(Array.from("ZXCVBNM")),
  Object.freeze(Array.from("ĄĆĘŁŃÓŚŹŻ")),
  Object.freeze(["-", ".", ",", "'", "/"]),
]);

export function removeLastKeyboardCharacter(value) {
  const characters = Array.from(String(value ?? ""));
  characters.pop();
  return characters.join("");
}

export function appendKeyboardCharacter(value, character, maxLength = Number.POSITIVE_INFINITY) {
  const current = String(value ?? "");
  const addition = String(character ?? "");
  const limit = Number.isFinite(Number(maxLength)) && Number(maxLength) >= 0
    ? Math.floor(Number(maxLength))
    : Number.POSITIVE_INFINITY;
  return Array.from(current + addition).slice(0, limit).join("");
}

function dispatchValueEvent(target, type) {
  const EventConstructor = target?.ownerDocument?.defaultView?.Event ?? globalThis.Event;
  if (typeof EventConstructor === "function") {
    target.dispatchEvent(new EventConstructor(type, { bubbles: true }));
  }
}

function usableTextInput(target) {
  if (!target || target.disabled || target.readOnly) return false;
  if (target.matches?.("textarea")) return true;
  if (!target.matches?.("input")) return false;
  return ["", "text", "search", "email", "url", "tel"].includes(String(target.type || "").toLowerCase());
}

export function createGamepadKeyboard(options = {}) {
  const documentTarget = options.documentTarget ?? (typeof document !== "undefined" ? document : null);
  const dialog = options.dialog ?? documentTarget?.getElementById?.("gamepad-keyboard");
  const rowsHost = options.rowsHost ?? documentTarget?.getElementById?.("gamepad-keyboard-rows");
  const preview = options.preview ?? documentTarget?.getElementById?.("gamepad-keyboard-preview");
  const targetLabel = options.targetLabel ?? documentTarget?.getElementById?.("gamepad-keyboard-target");
  const hint = options.hint ?? documentTarget?.getElementById?.("gamepad-keyboard-hint");
  if (!documentTarget || !dialog || !rowsHost || !preview) return null;

  let target = null;
  let originalValue = "";
  let upperCase = true;

  const keyButtons = [];
  const updateKeyLabels = () => {
    for (const button of keyButtons) {
      const base = button.dataset.gamepadKey || "";
      button.textContent = upperCase ? base : base.toLocaleLowerCase("pl-PL");
      button.setAttribute("aria-label", "Type " + button.textContent);
    }
    const shift = dialog.querySelector('[data-gamepad-keyboard-action="shift"]');
    if (shift) {
      shift.textContent = upperCase ? "Aa" : "aA";
      shift.setAttribute("aria-pressed", String(!upperCase));
    }
  };

  GAMEPAD_KEYBOARD_ROWS.forEach((characters, rowIndex) => {
    const row = documentTarget.createElement("div");
    row.className = "gamepad-keyboard-row";
    row.setAttribute("role", "group");
    for (const character of characters) {
      const button = documentTarget.createElement("button");
      button.type = "button";
      button.className = "gamepad-keyboard-key";
      button.dataset.gamepadKey = character;
      button.id = "gamepad-key-" + rowIndex + "-" + keyButtons.length;
      row.append(button);
      keyButtons.push(button);
    }
    rowsHost.append(row);
  });

  const updatePreview = () => {
    const value = target?.value ?? "";
    preview.textContent = value || "\u00a0";
    preview.classList.toggle("empty", !value);
  };

  const setValue = (value, emit = true) => {
    if (!target) return;
    target.value = value;
    updatePreview();
    if (emit) dispatchValueEvent(target, "input");
  };

  const close = (result, restore = false) => {
    const input = target;
    if (!input) return false;
    if (restore) setValue(originalValue);
    else dispatchValueEvent(input, "change");
    target = null;
    if (dialog.open) dialog.close(result);
    if (!restore) {
      const submitSelector = input.dataset.gamepadSubmitTarget;
      const submitTarget = submitSelector === ":form-submit"
        ? input.closest?.("form")?.querySelector?.('[type="submit"]')
        : submitSelector ? documentTarget.querySelector(submitSelector) : null;
      if (submitTarget && !submitTarget.disabled) submitTarget.focus?.({ preventScroll: true });
      else input.focus?.({ preventScroll: true });
    } else {
      input.focus?.({ preventScroll: true });
    }
    return true;
  };

  const performAction = (action) => {
    if (!target) return false;
    if (action === "backspace") setValue(removeLastKeyboardCharacter(target.value));
    else if (action === "space") setValue(appendKeyboardCharacter(target.value, " ", target.maxLength));
    else if (action === "clear") setValue("");
    else if (action === "shift") {
      upperCase = !upperCase;
      updateKeyLabels();
    } else if (action === "done") return close("done", false);
    else if (action === "cancel") return close("cancel", true);
    else return false;
    return true;
  };

  dialog.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button || !dialog.contains(button)) return;
    const character = button.dataset.gamepadKey;
    if (character != null && target) {
      const visibleCharacter = upperCase ? character : character.toLocaleLowerCase("pl-PL");
      setValue(appendKeyboardCharacter(target.value, visibleCharacter, target.maxLength));
      return;
    }
    if (button.dataset.gamepadKeyboardAction) performAction(button.dataset.gamepadKeyboardAction);
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    performAction("cancel");
  });

  updateKeyLabels();

  return {
    open(input, labels = {}) {
      if (!usableTextInput(input)) return false;
      if (dialog.open && target === input) return true;
      if (dialog.open) close("cancel", true);
      target = input;
      originalValue = input.value;
      upperCase = true;
      updateKeyLabels();
      updatePreview();
      if (targetLabel) targetLabel.textContent = input.getAttribute("aria-label") || input.placeholder || "Text input";
      if (hint) {
        const confirm = labels.confirm || "A / Cross";
        const back = labels.back || "B / Circle";
        hint.textContent = "Left stick or D-pad: move · " + confirm + ": select · " + back + ": cancel";
      }
      dialog.showModal();
      keyButtons[0]?.focus?.({ preventScroll: true });
      return true;
    },
    close: () => close("done", false),
    cancel: () => close("cancel", true),
    performAction,
    get isOpen() { return Boolean(dialog.open && target); },
    get target() { return target; },
  };
}

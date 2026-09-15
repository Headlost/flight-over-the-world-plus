const key = (value) => Object.freeze({ key: value });

function freezeProfile(profile) {
  for (const line of profile.desktopLines) Object.freeze(line);
  for (const row of profile.helpRows) Object.freeze(row);
  Object.freeze(profile.desktopLines);
  Object.freeze(profile.helpRows);
  return Object.freeze(profile);
}

const COMMON_FLIGHT_LINE = Object.freeze([
  key("Shift"), " faster · ", key("Ctrl"), " slower · ",
  key("C"), " center camera · ", key("Esc"), " pause",
]);

const COMMON_VIEW_ROW = Object.freeze({
  term: "Center view",
  description: "Returns the camera to the default chase view.",
});

const COMMON_PAUSE_ROW = Object.freeze({
  term: "Pause",
  description: "Stops the flight and opens the pause menu.",
});

const PROFILES = Object.freeze({
  ordinary: freezeProfile({
    desktopLines: [
      [key("W/S"), " pitch · ", key("A/D"), " roll and steer"],
      COMMON_FLIGHT_LINE,
      ["Right-drag to look around · scroll to zoom"],
    ],
    touchSummary: "Drag the joystick to pitch and steer the aircraft.",
    helpRows: [
      {
        term: "Joystick",
        description: "Up and down control pitch; left and right roll and steer the aircraft.",
      },
      {
        term: "Faster / Slower",
        description: "Hold to increase or reduce airspeed.",
      },
      COMMON_VIEW_ROW,
      COMMON_PAUSE_ROW,
    ],
    stickLabel: "Aircraft pitch and roll control",
  }),

  dzikiDzik: freezeProfile({
    desktopLines: [
      [key("W/S"), " loops · ", key("A/D"), " rolls · ", key("Q/E"), " rapid turns"],
      [key("Z"), " twin smoke · ", ...COMMON_FLIGHT_LINE],
      ["Right-drag to look around · scroll to zoom"],
    ],
    touchSummary: "Use the joystick for loops and rolls, and Q / E for rapid turns.",
    helpRows: [
      {
        term: "Joystick",
        description: "Up and down perform loops; left and right perform rolls.",
      },
      {
        term: "Q / E",
        description: "Hold for rapid left and right turns.",
      },
      {
        term: "Faster / Slower",
        description: "Hold to increase or reduce airspeed.",
      },
      {
        term: "Smoke",
        description: "Turns the twin aerobatic smoke trails on or off.",
      },
      COMMON_VIEW_ROW,
      COMMON_PAUSE_ROW,
    ],
    stickLabel: "Aerobatic loop and roll control",
  }),

  parachutist: freezeProfile({
    desktopLines: [
      ["On foot: ", key("W/S"), " walk · ", key("Shift + W"), " run · ", key("A/D"), " turn · ", key("Space"), " gentle takeoff · ", key("R"), " high takeoff"],
      ["Under canopy: ", key("A/D"), " steer · hold ", key("W"), " gentle climb · ", key("S"), " descend and slow · ", key("Shift/Ctrl"), " faster/slower"],
      ["Right-drag to look around · scroll fully in for first-person · ", key("C"), " center camera · ", key("Esc"), " pause"],
    ],
    touchSummary: "Walk or steer with the joystick; hold Faster to run forward. Takeoff controls appear after landing.",
    helpRows: [
      {
        term: "Joystick on foot",
        description: "Up and down walk forward or backward; left and right turn.",
      },
      {
        term: "Joystick under canopy",
        description: "Left and right steer, up gives a gentle climb, and down descends and slows.",
      },
      {
        term: "Takeoff",
        description: "After landing, choose Gentle takeoff or High takeoff.",
      },
      {
        term: "Faster / Slower",
        description: "Hold Faster with the joystick forward to run on foot. Under canopy, these buttons change horizontal speed.",
      },
      {
        term: "First-person view",
        description: "Zoom fully in to use the first-person camera.",
      },
      COMMON_VIEW_ROW,
      COMMON_PAUSE_ROW,
    ],
    stickLabel: "Parachutist walk and canopy steering control",
  }),

  rocketAtmosphere: freezeProfile({
    desktopLines: [
      [key("W/S"), " pitch · ", key("A/D"), " roll and steer · ", key("R"), " launch to orbit"],
      COMMON_FLIGHT_LINE,
      ["Right-drag to look around · scroll to zoom"],
    ],
    touchSummary: "Fly with the joystick, then use Launch to orbit when ready.",
    helpRows: [
      {
        term: "Joystick",
        description: "Up and down control pitch; left and right roll and steer the rocket.",
      },
      {
        term: "Faster / Slower",
        description: "Hold to increase or reduce atmospheric flight speed.",
      },
      {
        term: "Launch to orbit",
        description: "Starts a vertical ascent and automatic orbital insertion in Free flight.",
      },
      COMMON_VIEW_ROW,
      COMMON_PAUSE_ROW,
    ],
    stickLabel: "Rocket pitch and roll control",
  }),

  rocketSpace: freezeProfile({
    desktopLines: [
      [key("W/S"), " pitch · ", key("A/D"), " yaw · ", key("Shift"), " hyperdrive · ", key("Ctrl"), " precision"],
      [key("R"), " enter or release orbit · ", key("E"), " descend from orbit"],
      [key("1–9"), " planets · ", key("0"), " Galactic Core · ", key("-"), " Sun · ", key("C"), " center camera · ", key("Esc"), " pause"],
    ],
    touchSummary: "Steer with the joystick, choose a destination, then use the wide action buttons below.",
    helpRows: [
      {
        term: "Joystick",
        description: "Up and down control pitch; left and right control yaw.",
      },
      {
        term: "Faster / Slower",
        description: "Faster engages hyperdrive; Slower gives precision control.",
      },
      {
        term: "Destinations",
        description: "Choose a planet, the Sun or the Galactic Core in the top selector.",
      },
      {
        term: "Approach / orbit",
        description: "Approach the selected body, then enter or release its orbit.",
      },
      {
        term: "Descend",
        description: "From orbit, enter the planet's atmosphere or begin a surface descent.",
      },
      COMMON_VIEW_ROW,
      COMMON_PAUSE_ROW,
    ],
    stickLabel: "Spaceflight pitch and yaw control",
  }),
});

const ORDINARY_VEHICLE_KEYS = new Set(["ordinary", "pa28", "q400", "citation", "jet"]);

function normalizedVehicleKey(vehicleKey) {
  return typeof vehicleKey === "string" ? vehicleKey.trim().toLowerCase() : "";
}

function usesSpaceControls(options) {
  if (options === true || options === "space") return true;
  if (!options || typeof options !== "object") return false;
  return options.space === true || options.mode === "space" || options.context === "space";
}

/**
 * Resolve a vehicle id to a small set of UI control profiles.
 * Unknown values deliberately fall back to the ordinary aircraft controls.
 */
export function vehicleControlProfileKey(vehicleKey, options = {}) {
  const normalized = normalizedVehicleKey(vehicleKey);
  if (ORDINARY_VEHICLE_KEYS.has(normalized)) return "ordinary";
  if (["dzikidzik", "dziki-dzik", "dziki_dzik"].includes(normalized)) return "dzikiDzik";
  if (["parachutist", "paraglider"].includes(normalized)) return "parachutist";
  if (normalized === "rocket") return usesSpaceControls(options) ? "rocketSpace" : "rocketAtmosphere";
  return "ordinary";
}

/**
 * Return plain text and key tokens that callers can render with textContent.
 * No profile contains HTML or markup authored by a vehicle id.
 */
export function getVehicleControls(vehicleKey, options = {}) {
  return PROFILES[vehicleControlProfileKey(vehicleKey, options)];
}

export const VEHICLE_CONTROL_PROFILES = PROFILES;

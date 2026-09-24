# Model assets in the local game

The active aircraft are `airbus-a380.glb`, `boeing-737-800.glb`,
`lockheed-ac-130-hercules.glb`, `mooney-m20m.glb`, and
`northrop-grumman-b-2-spirit.glb`. They were prepared from the replacement
archives placed in `Nowe modele/` on 2026-09-23 with
`scripts/blender/prepare_original_aircraft.py`. The original ZIP files are
untouched. The previously used aircraft binaries and their original
attribution are preserved locally under
`.local-baselines/third-party-aircraft-2026-09-23/`; none of those binaries is
loaded by the game now. The replacement archives contain no embedded rights
statement. The project owner states that the designs of all currently active
vehicle and character models are their own work, credited to **Headlost**.
This includes the five aircraft above as well as `fighter.glb`, `rocket.glb`,
and `parachutist-body.glb`. This authorship statement does not cover terrain,
music, recordings, libraries, or the inactive historical source below. The
parachute canopy, suspension lines, and motion controller remain
project-generated.

## Retained historical character source

`parachutist.glb` is an inactive source for the earlier Blender character
study. It derives from `examples/models/gltf/Soldier.glb` in three.js r170,
from Quaternius's **Ultimate Animated Character Pack** (CC0 1.0). It is not
used as a vehicle or the current in-game parachutist body.

- SHA-256: `DFB230FC1F942F259DD00281A1186953AD602FC5D69067CE63E24B2AA439736B`
- Source: https://github.com/mrdoob/three.js/blob/r170/examples/models/gltf/Soldier.glb
- Original pack: https://quaternius.com/packs/ultimatedanimatedcharacter.html

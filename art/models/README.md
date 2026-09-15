# Spadochroniarz — projekt animacji

Otwórz `parachutist-studio.blend` w Blenderze. Scena zawiera postać używaną
w grze z czaszą i linkami oraz model Vanguard z odzyskanym szkieletem.
Oryginalna otwarta scena została zachowana w lokalnej kopii
`.local-baselines/parachutist-blender-2026-09-15/original-open-scene.blend`.

## Oglądanie i edycja

- **Spacja** uruchamia animację osi czasu. Znaczniki oznaczają kolejne ruchy.
- Sekwencje: bezruch, chód, bieg, lot, pociągnięcie lewej/prawej linki,
  oburęczne hamowanie, miękkie i mocne lądowanie.
- Vanguard: zaznacz szkielet; animacje są dostępne jako akcje i ścieżki NLA.
- Postać gry: edytuj nazwane kontrolery barków, łokci, nadgarstków,
  bioder, kolan i butów. Kształty dłoni i linek mają zapisane klatki animacji.
- Kamery pokazują całą czaszę oraz zbliżenie obu postaci.

## W grze

**W/S** — chód do przodu/do tyłu. **Shift + W** — bieg.
Na ekranie dotykowym użyj ruchu do przodu i przycisku **Faster**.
Praca dłoni w locie odpowiada sterowaniu i hamowaniu. Głębokość ugięcia
kolan przy lądowaniu zależy od prędkości opadania przy kontakcie z podłożem.

## Odtworzenie projektu ze źródeł

```powershell
node scripts/export-parachutist-studio.mjs
& 'E:/blender.exe' --background --factory-startup --python scripts/blender/build_parachutist_studio.py
```

Skrypt eksportuje rzeczywistą geometrię i pozy ze źródeł gry, następnie
tworzy nowy projekt Blendera. Nie nadpisuje kopii oryginalnej sceny.
Animacje Vanguard są dopasowane do jego szkieletu; oryginalne akcje
z `public/models/parachutist.glb` pozostają zachowane jako źródłowe.
Informacje o pochodzeniu tego modelu: `public/models/ATTRIBUTION.md`.

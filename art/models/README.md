# Spadochroniarz — projekt animacji

Aktualizacja 2026-09-22: nowy wygląd postaci jest w
`public/models/parachutist-body.glb`. W grze siatka korzysta z 14 punktów
istniejącego rigu; sterownik chodu, ramion, linek i czasza pozostają bez zmian.
Poprzedni `public/models/parachutist.glb` pozostaje zachowany jako źródło
wcześniejszego projektu Blendera. Pięć wycofanych modeli samolotów znajduje
się w `art/models/archived-vehicles-2026-09-22/`.

Aktualizacja 2026-09-23: kolejne pięć wcześniej używanych samolotów zostało
zastąpionych plikami z `Nowe modele/`. Ich poprzednie binaria wraz z ówczesnym
opisem pochodzenia są wyłącznie w lokalnym archiwum
`.local-baselines/third-party-aircraft-2026-09-23/`. Aktywne GLB zawierają
osie śmigieł i dysz przygotowane przez
`scripts/blender/prepare_original_aircraft.py`; ruch wirników i ogień silników
powstają w grze. Archiwum nie jest częścią aktywnej gry.

### Mooney M20M — edytowalna korekta

`mooney-m20m-edited.blend` zawiera finalną siatkę, UV, spakowane tekstury,
żółte zaokrąglone końcówki skrzydeł i marker trzyłopatowego śmigła. Wersja
gry to `public/models/mooney-m20m.glb`; podglądy z czterech stron są w
`art/previews/mooney-m20m-*.png`.

Powtarzalna korekta w `scripts/blender/prepare_original_aircraft.py` bierze
lokalny model z `Nowe modele/SP-ZAK Nowy.zip` (rozpakowany wcześniej do
`.local-baselines/new-aircraft-import-2026-09-23/mooney-m20m.glb`). Usuwa
wyłącznie odłączone wyspy zdublowanego dolnego statecznika i stare łopaty,
punktowo usuwa napisy i czarne emblematy z atlasu, a następnie przygotowuje
eksport GLB. Oryginalne archiwum nie jest modyfikowane. Projekt `.blend` można
też odtworzyć ze skorygowanego GLB skryptem
`scripts/blender/save_imported_model_blend.py`.

### Hercules AC-130 — stateczniki

Aktywny `public/models/lockheed-ac-130-hercules.glb` ma oba poziome
stateczniki jednolicie zielone. Retusz punktowo usuwa także czerwone
emblematy z białych boków pionowego statecznika i ich artefakty UV; pozostawia
czarne godło oraz światła na końcach skrzydeł i ogona. Oryginalny model
źródłowy pozostaje nietknięty w lokalnym
`.local-baselines/new-aircraft-import-2026-09-23/`.

Powtarzalny eksport wykonuje `scripts/blender/prepare_original_aircraft.py`
z kluczem `lockheed-ac-130-hercules`. Podglądy przed i po są w
`art/previews/hercules-before-top.png` i `art/previews/hercules-after-top.png`;
ukośny widok z tyłu to `art/previews/hercules-after-quarter-rear.png`.

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

## Free Flight — cywilna postać

Tryb jest tymczasowo zarchiwizowany: nie pojawia się w wyborze pojazdów ani
w nowych sesjach sieciowych. Pliki źródłowe, GLB i testy modelu pozostają
lokalnie, aby można było później wrócić do prac bez odtwarzania postaci.

`free-flyer-studio.blend` jest edytowalnym źródłem postaci używanej w trybie
Free Flight. Model ma rzeczywistą skalę około 1,82 m, siedem nazwanych części
(`BODY`, `EYES`, `TSHIRT_WHITE`, `SHIRT_BLUE`, `PANTS_BROWN`, `SHOES_WHITE`,
`HAIR`) oraz szkielet `RIG_DEFORM`. Szkielet obejmuje kończyny, kości skrętne,
dłonie i palce, szyję i głowę, a także kości włosów oraz rozpiętych poł koszuli
przeznaczone do lekkiej fizyki wtórnej w grze.

W pliku znajdują się klipy `Idle`, `Walk`, `Run`, `Flight`, `Takeoff` i `Land`.
Wersja webowa jest eksportowana do `public/models/free-flyer.glb`; nie wymaga
symulacji Cloth ani Rigify podczas działania gry.

Odtworzenie i niezależna walidacja:

```powershell
& 'E:/blender.exe' --background --factory-startup --python scripts/blender/build_free_flyer_studio.py
& 'E:/blender.exe' --background --factory-startup --python scripts/blender/validate_free_flyer_asset.py
```

Pierwszy skrypt generuje `.blend`, GLB, podgląd i raport budowy. Drugi otwiera
GLB w czystej scenie i sprawdza wysokość, nazwy, skinning, kości oraz animacje.

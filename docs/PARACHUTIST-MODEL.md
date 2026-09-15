# Spadochroniarz — model według referencji

## Animacje i projekt Blendera — 15.09.2026

Ruch postaci wyznacza wspólny moduł `src/game/parachutistMotion.js`. Chód i bieg mają naprzemienne podparcie stóp, zginanie kolan, pracę kostek, kołysanie miednicy i przeciwny ruch ramion. **Shift + W** lub ruch do przodu z dotykowym **Faster** włącza bieg. W locie ręce pociągają właściwe uchwyty, palce zaciskają chwyt, a nogi reagują na sterowanie i przygotowanie do przyziemienia. Ugięcie kolan i obniżenie miednicy przy lądowaniu zależą od prędkości opadania zarejestrowanej przed zatrzymaniem kontrolera; korekty wysokości terenu nie odtwarzają ponownie tego uderzenia.

Projekt [parachutist-studio.blend](../art/models/parachutist-studio.blend) zawiera obecną postać gry i model Vanguard z odzyskanym szkieletem oraz dziewięć sekwencji: bezruch, chód, bieg, lot, lewe i prawe sterowanie, hamowanie oraz dwa lądowania. [Instrukcja studia](../art/models/README.md) opisuje odtwarzanie i przebudowę projektu. Linki podążają za rzeczywistymi punktami chwytu; geometria rękawów w widoku pierwszoosobowym zachowuje połączenia bark–łokieć–dłoń.

Końcowa kontrola tej aktualizacji: kompilacja i 183 testy jednostkowe przeszły. Trzy scenariusze przeglądarkowe sprawdziły animacje na natywnej geometrii glTF, kolejne zmiany pojazdów oraz trzy pełne starty po zmianie samolotu i miasta. Testy używają kontrolowanego terenu i nie pobierają sesji z produkcyjnej puli.

## Model i materiały

Postać ma zielono-turkusowy kombinezon z jasnoniebieskimi panelami, kaptur z otwartą twarzą, ciemne gogle, szwy i kieszenie, rękawice, sznurowane buty oraz plecak z uprzężą. Zielono-niebieskie materiały zachowują neutralną fotograficzną fakturę nylonu i mają subtelną emisję, która poprawia czytelność sylwetki na jasnym oraz ciemnym tle bez spłaszczania fałd tkaniny. Szczegóły pasów, klamer, uchwytów i ubioru są łączone w siatki wewnątrz poruszających się przegubów. Obrót łokcia lub kolana przenosi odpowiadającą mu dłoń albo but, a głowa wykonuje subtelny ruch podczas marszu.

Sylwetka dorosłego ma około 1,91 m. Podeszwy w pozycji stojącej znajdują się 0,32 m poniżej początku modelu, zgodnie z istniejącym odstępem kontrolera od rozpoznanego podłoża. Kontroler nadal korzysta z natywnych pomiarów terenu i potwierdzenia kontaktu przy lądowaniu, a po wylądowaniu obsługuje marsz, krawędzie dachów i ponowne wznoszenie. Pozycje nośnych pasów są powiązane z mocowaniami na barkach; linki hamulców i czerwone uchwyty podążają za rękami.

Czarno-pomarańczowa czasza ma dziewięć komór z górną i dolną powierzchnią, zagłębionymi wlotami, wypukłością tkaniny, szwami i wzmocnionymi krawędziami. Rozgałęzione linki i cztery pasy nośne zachowują stałe bufory GPU. Podczas chodzenia czasza znika; przy starcie pojawia się ponownie. Widok pierwszoosobowy pozostawia czaszę i pokazuje osobny animowany model zielono-turkusowych rękawów z niebieskimi akcentami oraz taką samą subtelną emisją jak model postaci.

Materiały i geometrie należą do konkretnego gracza. Wspólne tekstury mają jawnie określony czas życia strony, dzięki czemu usunięcie jednej postaci nie niszczy zasobów pozostałych. Kolory rangi zmieniają niebieskie akcenty i pozostawiają zielono-turkusową bazę kombinezonu, twarz oraz gogle w podstawowej palecie.

Źródła: `src/game/parachutistCharacter.js`, `src/game/parachutistCanopy.js` i integracja w `src/game/paraglider.js`. Zasoby tekstur oraz opis ich wykonania znajdują się w `public/textures/parachutist/`.

Sprawdzenie obejmuje proporcje i kontakt podeszew, niezależność materiałów graczy, skończone dane geometrii, powiązanie linek z animacją oraz zachowanie tych samych buforów podczas kolejnych klatek. Osobny scenariusz przeglądarkowy wykorzystuje natywny teren glTF do startu, zejścia, przyziemienia, chodzenia i ponownego startu.

Weryfikacja 15.09.2026: 149 testów lokalnych i kompilacja przeszły. Natywny scenariusz przeglądarkowy potwierdził przyziemienie 0,32 m AGL, odległość renderowanych podeszew od podłoża 1,3–3,3 cm podczas końcowego uspokajania animacji, marsz, ruch głowy i kończyn, łagodny ponowny start oraz widok pierwszoosobowy. Bufory geometrii zachowały tożsamość i skończone wartości. Studio modelu z załadowanymi teksturami zgłosiło 72 wywołania rysowania i 38 804 trójkąty wraz z czaszą i linkami. Scenariusz używa kontrolowanej natywnej geometrii glTF, a nie płatnych sesji produkcyjnej mapy; nie jest pomiarem FPS na komputerze użytkownika.

# Utrzymanie strony (dla właściciela)

## Publikacja

Niezależne repozytorium docelowe: https://github.com/Headlost/flight-over-the-world-plus — nie jest forkiem. Adres docelowy gry: https://headlost.github.io/flight-over-the-world-plus/ — GitHub Pages z gotowego builda na gałęzi `codex/site`. Gra jest dostarczana jako strona online. Lokalne komendy służą wyłącznie pracom programistycznym; nie są instrukcją instalacji dla graczy.

Stare https://github.com/Headlost/flight-over-the-world pozostaje publicznym forkiem ze swoją dotychczasową historią. Nie jest miejscem publikacji kolejnych wersji pełnego drzewa ani nowej, niezależnej dystrybucji.

Domyślny dostęp do terenu używa dedykowanego workflow n8n wyłącznie do przydzielenia i odnowienia sesji. Kafelki są pobierane przez przeglądarkę bezpośrednio od dostawcy; nie należy kierować całego ruchu map przez n8n bez osobnych pomiarów wydajności. Przydziały wspólnej puli muszą wynikać z potwierdzonego użycia, limitu i okresu rozliczeniowego każdego konta zgodnie z `docs/N8N-TERRAIN.md`. Nieznanego budżetu nie wolno włączać produkcyjnie ani zmieniać kont w celu obchodzenia limitów chwilowych.

`VITE_CESIUM_ION_KEY` oraz `VITE_CESIUM_ION_FALLBACK_KEYS` pozostają wariantem lokalnym/deweloperskim. Każda wartość `VITE_*` użyta przez frontend trafia do kodu klienta: GitHub Secrets, hashowanie i minifikacja nie czynią jej tajną. Nie używać w tych zmiennych sekretów administracyjnych. Wartości lokalne pozostają w ignorowanym `.env.local` i nie mogą trafić do logów ani commita.

Gracz może opcjonalnie wybrać na ekranie startowym własny token Cesium ion. Gra zapisuje go tylko w `sessionStorage` bieżącej karty, nie dodaje do wspólnej puli, nie wysyła innym graczom ani do brokera i używa bezpośrednio do autoryzacji żądań terenu w Cesium ion. W tym trybie odrzucony token nie przełącza się na konto operatora. Pole formularza nie zapisuje tokenu w `localStorage`, ciasteczkach ani ustawieniach gry; pełna instrukcja i minimalne uprawnienia znajdują się w `docs/CESIUM-TOKEN.md`.

Mapa wyboru pinezki: Leaflet 1.9 + standardowe kafelki OpenStreetMap. Wyszukiwanie: publiczny Photon, bez klucza, tylko po zatwierdzeniu zapytania, z kolejką i podręczną pamięcią wyników. Domyślne usługi publiczne nie zapewniają SLA; przy większym ruchu należy uruchomić własny Photon lub uzgodnić warunki z dostawcą. Opcjonalne `VITE_GEOCODING_URL` wskazuje endpoint zgodny z odpowiedzią GeoJSON Photon. Limit w karcie nie jest globalnym limitem wszystkich graczy.

Źródła: [Leaflet](https://leafletjs.com/reference), [Photon](https://github.com/komoot/photon), [zasady kafelków OSM](https://operations.osmfoundation.org/policies/tiles/), [Map Tiles Google](https://developers.google.com/maps/documentation/tile/policies).

## Praca nad kodem

Node.js 22+. Dla lokalnego testu deweloperskiego istniejący token właściciela jest zapisany w ignorowanym `.env.local`.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm run dev` uruchamia serwer deweloperski. `npm run preview` sprawdza zbudowany `dist`. Publiczna wersja jest wdrażana z repozytorium, nie z tego serwera.

Testy przeglądarkowe używają osobnej, fałszywej konfiguracji terenu, aby nie zużywać prywatnych limitów. Kafelki i wyszukiwanie są zastępowane kontrolowanymi odpowiedziami. Sprawdzane są rzeczywiste zdarzenia Leaflet: kliknięcie mapy, przeciąganie pinezki, wpisanie współrzędnych oraz wybór wyniku wyszukiwania. Test bufora obrazu nie jest benchmarkiem fotogrametrii.

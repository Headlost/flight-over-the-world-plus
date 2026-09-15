# Rendering terenu 3D

## Używane źródło

Gra korzysta z assetu Cesium ion `2275207`, czyli Google Photorealistic 3D Tiles przesyłanych przez Cesium. Nie używa klucza Google Maps JavaScript API. Jest to obecnie najlepsze źródło o szerokim, międzynarodowym zasięgu dostępne w tej konfiguracji.

Fotogrametria została wykonana głównie z powietrza. Przy wysokości lotniczej wygląda realistycznie, ale oglądana z kilku metrów może mieć rozmyte elewacje, zdeformowane drzewa i brak drobnych elementów. Zmniejszenie błędu LOD może pobrać najdokładniejszy istniejący kafel, ale nie odtworzy szczegółu, którego nie ma w zdjęciach źródłowych.

## Profil szybkiego wyostrzania

Jedna kamera terenu, zgodna z aktualnym widokiem gracza, wybiera kafle do doczytania. Usunięto pomocniczy obrót kamery poza kadrem. Zachowano tylko wąską kolumnę dokładnych danych bezpośrednio pod pojazdem, potrzebną do pomiaru ziemi i kolizji. Nie poszerza ona widoku ani nie doczytuje otoczenia 360°. `loadAncestors` i `loadSiblings` są wyłączone razem: w wersji 0.5.2 samo `loadSiblings = false` nie wystarcza, ponieważ włączone `loadAncestors` wymusza pobieranie sąsiednich kafli. Własne wyostrzanie pobiera najpierw rodzica w widoku i utrzymuje go na ekranie, dopóki widoczne dzieci nie są gotowe, również po obrocie kamery. Uproszczone kafle zastępcze nie służą do ustalania wysokości ziemi ani kolizji: te pomiary korzystają z kafli o błędzie geometrycznym do 10 m, w tym dokładnej kolumny pobieranej niezależnie od wyostrzania obrazu.

| Sytuacja | Docelowy błąd LOD na komputerze | Pamięć pobranych kafli | Budżet GPU |
| --- | --- | --- | --- |
| Chodzenie | 2,75–6 zależnie od FPS | 700 MB | 240 MB |
| Lądowanie poniżej około 240 m | 4–6 | 620 MB | 220 MB |
| Lot, również na dużej wysokości | 7 | 520 MB | 180 MB |

Zachowano dotychczasowe docelowe błędy LOD, rozdzielczość pomiaru terenu i budżety pamięci pobranych danych. Nie zwiększa się błędu LOD na dużej wysokości ani nie dodaje mgły maskującej brakujące dane. Kamera terenu kończy zasięg dopiero tam, gdzie istniejąca mgła przepuszcza mniej niż 0,01% koloru terenu: około 43 km przy ziemi i dalej w górnej atmosferze. Bez mgły zachowuje pełen zasięg kamery sceny. Progi wysokości mają histerezę. Telefony mają mniejsze budżety. Liczba dekodowanych kafli i rozbudowywanych węzłów nadal zależy od FPS, prędkości i trybu odzyskiwania pamięci. Mipmapy i filtrowanie anizotropowe do 16× pozostają włączone.

Kafle oczekujące poza widokiem są usuwane z kolejki. Trwające, już zbędne pobieranie jest anulowane po 400 ms, aby krótki ruch kamery nie powodował ciągłego przerywania tych samych żądań. Powrót do menu, nowy lot i wejście w kosmos od razu zatrzymują oczekujące pobrania, zachowując załadowany renderer i sesję. Przy przekroczeniu budżetu niewidoczne zasoby GPU są zwalniane po 6 sekundach na komputerze, 1,5 sekundy na telefonie i 400 ms w trybie odzyskiwania pamięci. Widoczne kafle nie są wtedy usuwane. Dane pozostają w pamięci CPU, więc powrót do niedawno widzianego miejsca może odtworzyć tekstury bez ponownego pobierania.

Przed odsłonięciem gry sprawdzana jest rzeczywista geometria w dolnej części kadru, a nie same luźne granice kafli. Widok musi być pokryty danymi miasta przez co najmniej 350 ms. W tym czasie teren jest renderowany pod ekranem ładowania, aby wgrać widoczne tekstury na GPU i zakończyć ich pojawianie się. Nie czeka się na wyostrzenie całego odległego horyzontu.

## Ponowne używanie sesji

Renderer i tileset powstają raz na otwartą kartę, a start, restart, zmiana pojazdu i powrót z kosmosu korzystają z tego samego obiektu. Nie ma pobierania Google Tiles w ekranie startowym ani aktualizacji kafli w kosmosie. Samo ograniczenie LOD i zasięgu zmniejsza liczbę pobieranych kafli, ale nie zmienia miesięcznego licznika głównych kafli/sesji.

Usunięto automatyczne odnawianie głównego kafla Google po dowolnym błędzie 4xx. Błędy nieistniejącego kafla, uprawnień i limitu nie tworzą teraz nowej sesji. Odnowienie następuje wyłącznie po odpowiedzi wskazującej nieważną lub wygasłą sesję; równoczesne żądania współdzielą jedno odnowienie i próbują pobrać kafel jeszcze raz. Kolejne odnowienie jest ograniczone przez 30-sekundowy odstęp. Nie zmienia to konta Cesium. Google deklaruje co najmniej trzy godziny pobierania kafli po jednym żądaniu głównego tilesetu: [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles). Interpretację błędów opisuje [Google — Handling errors](https://developers.google.com/maps/documentation/tile/error_handling).

W `window.__dbg` można sprawdzić `terrainCameraCount`, `terrainViewDistance`, `terrainErrorTarget`, `terrainCacheLimitBytes` oraz `terrainRootRequests`. Testy używają fikcyjnych danych i sprawdzają widoczność, obrót kamery, anulowanie pobierania oraz liczbę żądań głównego tilesetu.

## Inne dane Cesium

- **Cesium World Terrain + Bing Maps Aerial + Cesium OSM Buildings** daje czytelne, regularne bryły budynków i globalny zasięg. Nie oferuje jednak fotograficznych elewacji; przy ziemi wygląda bardziej jak czysta makieta 3D niż realne miasto.
- **Vexcel 3D Cities** oferuje wysokiej jakości modele, ale obejmuje wybrane obszary metropolitalne i jest partnerskim, licencjonowanym zbiorem danych.
- **Aerometrex San Francisco High Resolution**, asset `1415196`, obejmuje San Francisco. Udostępniona wersja była niekomercyjną wersją próbną ważną do 18 grudnia 2024 roku, więc nie jest globalnym ani aktualnym zamiennikiem.
- Własne zdjęcia z drona lub skan miasta można przetworzyć i hostować w Cesium ion. To jedyna droga do jakości bliskiej cyfrowemu bliźniakowi w wybranym miejscu, ale wymaga pozyskania danych i osobnego budżetu.

## Limity Cesium ion

Według cennika Cesium ion plan Community jest bezpłatny dla osobistych projektów niekomercyjnych i obejmuje miesięcznie 15 GB streamingu oraz 1 000 głównych kafli Google Photorealistic 3D Tiles. Następny plan Commercial zaczyna się od 149 USD miesięcznie. Przy limicie projektu 10 USD należy pozostać w planie Community i obserwować zużycie; 500 użytkowników mieści się w limicie tylko wtedy, gdy łączna liczba uruchomień pobierających główny kafel nie przekroczy 1 000 miesięcznie.

Aktualne źródła:

- [Cesium ion — cennik i limity](https://cesium.com/platform/cesium-ion/pricing/)
- [Cesium — globalne i partnerskie dane 3D](https://cesium.com/platform/cesium-ion/content/)
- [3D Tiles Renderer — ustawienia LOD i pamięci](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/src/core/renderer/API.md)

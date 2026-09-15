# Ciągłość obrazu terenu — 14.09.2026

Doczytywanie nowego widocznego kafelka wymuszało pokazanie wspólnego zgrubnego rodzica i ukrywało już załadowane szczegółowe fragmenty. Podczas lotu kolejne kafelki powtarzały ten cykl, wywołując miganie, chwilową utratę szczegółów i ponowne wysyłanie danych rodzica do GPU.

Streamer zachowuje szczegółowe gałęzie, gdy są dostępne w rzeczywistym widoku kamery. Zgrubny rodzic pozostaje zabezpieczeniem pierwszego ładowania i obrotu w stronę niezaładowanej mapy. Gotowość uwzględnia zasady SDK dotyczące poziomów o równych błędach geometrycznych; pomijany poziom pośredni nie udaje gotowej powierzchni. Niewidoczna kolumna fizyki pod pojazdem również nie udaje gotowego widoku.

Osobno naprawiono kopułę nieba: jej promień przekracza dalszą płaszczyznę kamery. Wierzchołki są teraz rysowane na dalszej głębokości z zachowaniem testu głębi i bez zapisu do bufora głębokości. Teren i obiekty na pierwszym planie pozostają przed niebem.

Parametry ostrości, rozdzielczości i mgły atmosferycznej pozostają takie same. Pobieranie kafelków odbywa się bezpośrednio. Rozmycie pod menu pauzy jest oddzielnym efektem interfejsu.

Regresje obejmują doczytywanie sąsiada przez wiele klatek, obrót o 180°, pomijany poziom pośredni i kolumnę fizyki. Testy WebGL mierzą piksele podczas przejścia z aktywnym TilesFadePlugin oraz sprawdzają gradient nieba i głębię obiektu na pierwszym planie. Testy nie pobierają map od dostawców i nie stanowią benchmarku rzeczywistej fotogrametrii.

Walidacja: npm run build zakończony poprawnie (119 testów lokalnych); 18 wybranych testów przeglądarkowych terenu, lotu, startu, zmiany kursu, przestrzeni kosmicznej i renderowania przeszło.

## Ponowne starty i pamięć kafelków — 15.09.2026

Dwa niezależne stany pamięci mogły zablokować kolejny lot aż do przeładowania strony. Po błędzie pobierania SDK pozostawiało kafelek w pamięci LRU; samo ustawienie stanu „do pobrania” nie usuwało wpisu, więc kolejna próba nie wysyłała żądania. Ponowienie usuwa teraz wyłącznie błędny wpis przez zwykłe czyszczenie SDK, zwalniając jego poprzedni kontroler pobierania. Prawidłowo załadowane kafelki pozostają dostępne.

Druga blokada występowała po zapełnieniu pamięci poprzednim widokiem. SDK odrzucało żądania nowej mapy przed dodaniem ich do kolejki, a późniejsze zwolnienie pamięci nie budziło mechanizmu `UpdateOnChangePlugin`. Nieruchoma kamera ładowania nie mogła sama wznowić pracy. Renderer zapamiętuje teraz oczekiwanie na miejsce i wznawia przejście drzewa po faktycznym zwolnieniu pojemności; przy nadal pełnej pamięci nie wykonuje ciągłych dodatkowych przejść.

Obie usterki odtworzono najpierw w testach SDK i w przeglądarce: po odpowiedzi HTTP 503 drugie żądanie nie występowało, a po rzeczywistym usunięciu starego terenu z LRU mapa nowego miasta nadal nie była pobierana. Testy sprawdzają ponowne pobieranie i parsowanie, zachowanie udanych wpisów, zerowe pozostałości kolejek oraz start na natywnej geometrii nowego miasta. Osobny scenariusz obejmuje lądowanie spadochroniarza, chód, widok pierwszoosobowy, zmianę samolotu i dwa anulowania ładowania. Cele szczegółowości, rozdzielczość, kamera, mgła, budżety pamięci i bezpośrednie pobieranie kafelków nie zostały zmienione.

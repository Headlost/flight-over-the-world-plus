# Pominięte moduły źródłowe

Implementacja pominięta w publicznym eksporcie źródeł. Prawa autorskie pozostają przy właściwych autorach; oznaczenie nie zmienia licencji zależności ani wkładu osób trzecich.

- src/main.js: Orkiestracja rozgrywki i integracja prywatnych modułów.
- src/game/plane.js: Kontroler lotu i ruchu pojazdów.
- src/game/aerobaticPlane.js: Kontroler pełnego lotu akrobacyjnego.
- src/game/terrainRenderer.js: Optymalizacja doczytywania i pomiarów terenu.
- src/game/googleTileSession.js: Obsługa sesji dostępu do terenu.
- src/game/rotatingIonAuth.js: Integracja autoryzacji terenu.
- src/game/ionTokens.js: Kolejka i rotacja danych dostępu.
- src/game/terrainPoolAuth.js: Integracja kontrolowanej wspólnej puli sesji.

Ten eksport nie zawiera pełnej implementacji gry, sekretów, historii Git ani gotowego builda. Nie można go przebudować bez prywatnych modułów. Kod wykonywany w przeglądarce pozostaje możliwy do analizy.

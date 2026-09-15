# Przydzielanie sesji terenu przez n8n

Najnowsza decyzja użytkownika dopuszcza dedykowany workflow n8n na [box.zakai.eu](https://box.zakai.eu), bez instalowania dodatkowej usługi i bez SSH. Workflow „Flight Over the World — Terrain Session Pool” (`e2YB1YicM69MxPws`) został opublikowany na instancji 2.34.6. Endpoint i końcowy lokalny artefakt gry przeszły walidację z prawdziwym terenem i odnowieniem sesji. Gotowy build integracji jest aktywny w GitHub Pages: wdrożenie commitu 0791cd46d45e9cf180d64228cb3b39db6c18e99f ma status built. Wszystkie osiem sprawdzonych plików index.html, JavaScript i CSS online jest identycznych z lokalnym dist; skan JavaScript nie wykrył JWT ion.

Cesium zatwierdziło wspólną pulę kont według potwierdzenia użytkownika. Limity należą do kont, nie do poszczególnych tokenów. Kolejność jest stała: KrukWer → GoraM → PawelekMega → główny. Nie przełączamy kont w reakcji na krótkotrwałe 429 ani zwykłe odmowy uprawnień.

## Jednorazowa potwierdzona pula

Aktualny tryb `confirmedRemainingBatch` wykorzystuje jeden potwierdzony początkowy przydział, maksymalnie 1000 prób na każde z trzech kont wspierających. Użytkownik potwierdził, że ich kwoty nie były użyte. Główne konto pozostaje w logicznej kolejce, lecz jest zablokowane po potwierdzonym przekroczeniu kwoty. Po wykorzystaniu wspierających nie następuje ponowne rozpoczęcie kolejki. Rzeczywiste raporty i dane zużycia są przechowywane prywatnie, poza publiczną dystrybucją.

Okno `admissionStart`–`admissionUntil` określa ważność potwierdzenia wybraną przez operatora. **Nie opisuje okresu rozliczeniowego Cesium.** Ten wariant nie wymaga zgadywania strefy czasowej ani daty resetu: przez cały pierwszy przydział nie może zużyć więcej niż jego potwierdzona stała kwota. Wygaśnięcie okna zatrzymuje przyjęcia i nie odnawia budżetu. Nie ma resetu kalendarzowego, zwrotów po błędach ani automatycznego utworzenia kolejnej puli. Kolejny potwierdzony okres wymaga odrębnej, jawnej migracji.

Pierwsza rezerwacja utrwala konfigurację snapshotu, pozostałe przechowują jego identyfikator. Zmiana potwierdzonych baseline, kwot, blokad, okna lub identyfikatora po przydziale jest odrzucana. Liczniki i historia zajętych ID muszą pozostać spójne i trwałe. Żywy wiersz Data Table jest stanem autorytatywnym; lokalny prywatny bootstrap przedstawia tylko konfigurację początkową. Nie wolno odtwarzać go na używanym wierszu ani zastępować produkcyjnego ledgeru fikcyjnym plikiem testowym.

## Rezerwacja i ładowanie

Przed zapytaniem do endpointu ion i Google root workflow trwale rezerwuje jeden przydział oraz jednorazowe prawo wysłania. Warunkowy zapis Data Table (CAS) obejmuje wiersz, rewizję i pełny stan. Jego wynik wymaga zgodnej nowej rewizji, właściciela wykonania oraz treści JSON, co uwzględnia także zachowanie SQLite w n8n 2.34.6.

Duplikat zajętego `requestId` otrzymuje 409 i nie wykonuje ponownego rootu. Przy konflikcie zapisu `budget_busy` można ponowić rezerwację z tym samym ID; nie przyznano jeszcze wysłania. Próby nieudane, anulowane i diagnostyczne pozostają policzone. HTTP Request nie ponawia ani nie przekierowuje żądania. Nie ponawiać ręcznie wykonania od węzła HTTP, bo pomija to wcześniejszy przydział. Produkcyjne zapisy danych wykonania, błędów i postępu są wyłączone.

Broker obsługuje tylko początek i odnowienie sesji. Zwraca `{rootTileset, rootURL, googleKey, sessionToken, accountLabel}`. Przeglądarka przygotowuje otrzymany root zgodnie z SDK i wykorzystuje go bez ponownego pobierania. Dalsze kafelki płyną bezpośrednio z Google. Jednoznaczne wygaśnięcie sesji powoduje nowy przydział; istniejąca geometria pozostaje dostępna podczas odnowienia. Nie kierujemy strumienia kafelków przez n8n. Parametry ostrości i rozdzielczości pozostały niezmienione; zachowanie widocznego terenu przy odnowieniu potwierdzono również na prawdziwej mapie.

Zweryfikowany końcowy build korzysta z endpointu brokera bez tokenów ion w konfiguracji klienta. Skan skompilowanego JavaScript nie wykrył JWT; w próbie rzeczywistej mapy przeglądarka nie wysłała zapytań do Cesium. Długotrwałe tokeny pozostają w prywatnych credentials n8n. Klucz Google i identyfikator sesji nadal są dostępne w przeglądarce. CORS nie zastępuje uwierzytelnienia ani ochrony przed nadużyciem. Licznik obejmuje tylko żądania tego workflow; nie obserwuje późniejszego wykorzystania kont poza nim i nie zapewnia globalnej blokady całego konta. Osobny limit bajtów streamingu pozostaje poza tym mechanizmem.

## Stan walidacji — 2026-09-14

`npm run test:terrain-pool` zalicza 19/19 testów, w tym idempotencję, CAS, niezmienność pierwszej puli, zablokowane konto główne, wyczerpanie bez zawijania i wygaśnięcie okna bez resetu. Historia 3000 standardowych rezerwacji mieści się w limicie JSON 1 000 000 znaków dzięki jednemu zapisowi snapshotu. Nietypowo długie identyfikatory mogą zmniejszyć pojemność; nie ma automatycznego usuwania historii.

Dwa scenariusze `npx playwright test --config playwright.broker-only.config.js` przeszły na odpowiedziach fixture. Sprawdzają pełną aplikację bez tokenu ion w kliencie, start z otrzymanym rootem, bezpośrednie kafelki i zachowanie geometrii przy odnowieniu. Wcześniejszy proof na instancji potwierdził CAS dla 20 równoległych klientów i fikcyjnego limitu 10, bez prawdziwych zapytań do dostawców. Proof został wycofany z publikacji.

Końcowy build przeszedł kompilację, 120 testów jednostkowych, 19 testów puli i dwa scenariusze brokera w WebGL z domyślną osią Y-up glTF. Natywny wrapper rootu SDK i pamięć otrzymanej odpowiedzi zapewniają prawidłową orientację modeli i przygotowanie hierarchii bez ponownego pobierania rootu. Parametry grafiki pozostały niezmienione.

Rzeczywisty endpoint zwrócił 204 dla OPTIONS, 400 dla niewłaściwego Origin, 200 z poprawnym kontraktem dla pierwszego POST (777 ms) oraz 409 dla duplikatu. Końcowy start gry z prawdziwą mapą wykorzystał wcześniej przyjęty grant diagnostyczny i osiągnął gotowość po 21,337 s. Odnowienie sesji trwało 1033 ms, a odnowienie z kolejnym bezpośrednim kafelkiem 1371 ms.

Instalacja odnowionej sesji zachowała modele, geometrię, cache, root i grupę bez utylizacji. W 61 próbkach requestAnimationFrame podczas odnowienia było co najmniej 237 widocznych kafelków; porównanie zrzutów ekranu przed odnowieniem i po nim potwierdziło ostry teren. Późniejsze naturalne zwalnianie kafelków przez LOD/LRU pozostaje dozwolone i nie oznacza wyczyszczenia terenu przez podmianę sesji. W tym przebiegu zaobserwowano 1054 żądania podrzędnych danych Google, zero ponownych Google root z przeglądarki, zero zapytań Cesium z klienta i brak błędów strony. Rzeczywiste próby i odnowienia pozostają policzone; ich bieżące liczniki są prywatne. Pomiary opisują konkretny przebieg i nie stanowią gwarancji czasu każdego startu.

## Granice publikacji

Pełne drzewo deweloperskie i jego główne commity pozostają lokalne. Zgodnie z [PUBLIC-SOURCE.md](PUBLIC-SOURCE.md) do `codex/public-source` trafia wyłącznie wygenerowany eksport z pominięciami, a do `codex/site` wyłącznie zweryfikowany lokalny build `dist`. Nie wypychać pełnego drzewa do publicznego origin. Przed wygenerowaniem dystrybucji zaliczyć `npm run build` i odpowiednie testy przeglądarkowe. Stary workflow Deploy budujący zdalny main pozostaje wyłączony.

Końcowy build integracji jest wdrożony z codex/site. GitHub Pages potwierdził status built dla commitu 0791cd46d45e9cf180d64228cb3b39db6c18e99f, a wszystkie osiem sprawdzonych plików index.html, JavaScript i CSS online ma identyczne SHA jak lokalny dist. Opublikowana gra korzysta z przydzielania i odnowienia sesji przez broker; kafelki pobiera bezpośrednio z Google. Nie deklarować usunięcia tokenów z wcześniejszych buildów, usunięcia starej historii Git ani ochrony zapewnianej przez hashing, minifikację lub GitHub Secrets. Kod wykonywany w przeglądarce pozostaje dostępny.

Operacyjne helpery i ich README pozostają w lokalnym katalogu `server/n8n/`, który jest celowo wykluczony z publicznego eksportu. Referencje: [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [n8n Data Tables](https://docs.n8n.io/data/data-tables/), [Cesium tokeny](https://cesium.com/learn/ion/cesium-ion-access-tokens/), [Cesium optymalizacja limitów](https://cesium.com/learn/ion/optimizing-quotas/).

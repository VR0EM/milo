# Milo testen op Windows

Milo is nog niet ondertekend, dus Windows waarschuwt bij de eerste keer. Dat is normaal.

## Installeren

1. Open op GitHub de repository, tab **Actions**, en klik op de bovenste geslaagde run (groen vinkje).
2. Onderaan bij **Artifacts**: download `milo-windows` en pak het zip-bestand uit.
3. Start `Milo_0.2.0_x64-setup.exe`.
4. Verschijnt "Windows heeft uw pc beschermd": klik **Meer informatie** en dan **Toch uitvoeren**.
5. Milo staat daarna in het Startmenu.

Je gegevens staan in `%APPDATA%\app.milo.desktop` (één bestand `milo.sqlite` en een map `backups`).
Opnieuw installeren of updaten laat die map staan.

## Wat testen

Probeer gewoon een paar dagen te gebruiken zoals je wil. Let vooral op:

- **Kalender**: dubbelklikken, slepen, verlengen, met de touchpad swipen en met Ctrl + scrollen zoomen.
- **Rooster**: Import & export, Add link, je schoollink plakken. Komen de lessen goed binnen, op het juiste uur?
- **Herinneringen**: Reminders, "Send a test reminder". Zie je een melding rechtsonder?
  Zo niet: Windows Instellingen, Systeem, Meldingen, en zet Milo aan.
- **Afvinken op Today**: zet bij Reminders de medicatie aan. Verschijnt "Check off today" op Today?
- **Focus**: start een focus-sessie. Krijg je een melding als de tijd om is?
- **Rooster als taken**: zet bij Import & export je deadlines-link op "As tasks". Staan ze in Tasks met de juiste deadline?
- **Tweede backupmap**: Settings, Your data, kies bv. een USB-stick. Staat er een kopie in?
- **Venster sluiten**: Milo hoort rechtsonder in het systeemvak (bij de klok) te blijven. Klik op het icoon om terug te openen.
- **Opstarten met Windows**: Settings, Startup. Werkt het na een herstart?
- **Lettertypes en grootte**: Settings, Text. Leesbaar op jouw scherm?
- **Sneltoetsen**: Ctrl+1 tot Ctrl+7, Ctrl+komma, en `?` voor het overzicht.

## Iets gevonden?

Noteer per probleem: wat je deed, wat je verwachtte, wat er gebeurde, en liefst een screenshot
(Windows + Shift + S). Dat is genoeg om het te herstellen.

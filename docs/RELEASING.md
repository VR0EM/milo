# Een nieuwe versie van Milo uitbrengen

Geïnstalleerde Milo's vragen GitHub welke versie de nieuwste is (Settings > Updates, en
hooguit één keer per dag bij het opstarten). Ze installeren een update pas als je vriendin op
**Install and restart** klikt. Haar gegevens blijven staan.

## Eenmalig: de ondertekensleutel

Updates worden ondertekend, zodat Milo alleen updates van jou aanvaardt.

- De **geheime sleutel** staat in `~/.tauri/milo.key` op deze Mac. **Maak er een backup van**
  (bv. in je wachtwoordmanager). Ben je hem kwijt, dan kunnen geïnstalleerde Milo's geen
  updates meer aanvaarden en moet ze opnieuw handmatig installeren.
- De **publieke sleutel** staat in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- GitHub heeft de geheime sleutel nodig als repository secret:

  ```bash
  gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/milo.key
  ```

  De sleutel heeft geen wachtwoord, dus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is niet nodig.

## Elke keer: een versie uitbrengen

1. Zorg dat alles gecommit is.
2. Kies een nieuw versienummer, hoger dan het vorige:

   ```bash
   npm run release -- 0.3.0
   ```

   Dit zet het nummer in `package.json`, `tauri.conf.json` en `Cargo.toml`, commit dat en maakt
   de tag `v0.3.0`.
3. Push de commit en de tag:

   ```bash
   git push && git push origin v0.3.0
   ```

4. GitHub Actions (workflow **Release**) bouwt Milo voor Windows en macOS en zet het op de
   Releases-pagina, samen met `latest.json`. Na ongeveer tien minuten ziet Milo de update.

## De eerste keer op haar laptop

De versie die ze nu heeft (uit de Artifacts van de gewone build) kent de updater nog niet.
Installeer één keer de `-setup.exe` van de eerste Release; vanaf dan werkt Milo zichzelf bij.

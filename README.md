# Stride — persoonlijke run-tracker

Een Strava-achtige web-app (PWA). Je activiteiten staan in de browser van je telefoon (IndexedDB); alleen samenvattingen van runs gaan naar je vriendengroep als je inlogt.

## Functies
- **Opnemen**: live GPS, kaart, tijd/afstand/tempo, auto-pauze, rondes, gesproken updates (NL), scherm blijft aan, herstel na een crash, route volgen als stippellijn.
- **Hartslag**: Bluetooth-borstband (Chrome op Android). Safari op iPhone ondersteunt geen Web Bluetooth; hartslag uit een geïmporteerde GPX werkt wel.
- **Activiteiten**: lijst per week, detail met kaart, splits, tempo-, hoogte- en hartslaggrafiek (aanraken = punt op de kaart), hartslagzones, beste prestaties en PR's, bewerken, GPX-export.
- **Routes**: plannen op de kaart (optioneel over paden via routing.openstreetmap.de), opslaan vanuit een activiteit, GPX-import/-export.
- **Segmenten**: maak een segment van een deel van een activiteit; elke run erover wordt automatisch getimed en gerangschikt.
- **Training**: weekdoel, km per week, fitheid/vermoeidheid/vorm (CTL/ATL/TSB), trainingsschema's voor 5K t/m marathon die zichzelf afvinken.
- **Vrienden**: groepen met uitnodigingslink, inloggen met e-mailcode, feed met de laatste runs, ranglijsten (meeste km per week/maand/jaar, snelste 5K/10K/halve, langste reeks). Alleen afstand, tijd en tempo worden gedeeld — nooit je route. Vereist een gratis Supabase-project: zie `supabase/SETUP.md`.
- **Talen**: Nederlands, English, Italiano, Русский (ook de gesproken updates).
- **Ik**: totalen, records, profiel (hartslag, drempeltempo), instellingen, backup/terugzetten, GPX-bulkimport (bijv. uit je Strava-export).

## Lokaal draaien
```
node serve.mjs
```
Open http://localhost:5178 — met `?sim` erachter (`/index.html?sim#/record`) loop je een gesimuleerd rondje om alles te testen.

## Op je telefoon
GPS en installeren werken alleen via **https**. Zet de map op een statische host (bijv. Vercel, Netlify, GitHub Pages), open de URL op je telefoon en kies **Zet op beginscherm**.

Let op: een web-app kan GPS niet op de achtergrond bijhouden. Houd het scherm aan (de app vraagt daarom een wake lock) en zet de helderheid laag.

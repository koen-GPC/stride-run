# Supabase instellen (eenmalig, ±10 minuten)

1. Maak een gratis account op https://supabase.com en klik **New project** (naam bijv. `stride`, regio *West EU*). Het database-wachtwoord heeft de app niet nodig; bewaar het voor jezelf.
2. **SQL Editor → New query**: plak de hele inhoud van `schema.sql` en klik **Run**. Je zou "Success. No rows returned" moeten zien.
3. **Authentication → URL Configuration**
   - **Site URL**: `https://koen-gpc.github.io/stride-run/`
   - **Redirect URLs**: voeg `https://koen-gpc.github.io/stride-run/**` toe
4. **Authentication → Emails (Templates) → Magic Link**: zet de code in de mail, zodat je vrienden op iPhone in de app kunnen inloggen. Vervang de inhoud bijvoorbeeld door:
   ```html
   <h2>Je Stride-code</h2>
   <p>Typ deze code in de app: <b style="font-size:22px">{{ .Token }}</b></p>
   <p>Of tik op <a href="{{ .ConfirmationURL }}">deze link</a> (alleen als je Stride in deze browser gebruikt).</p>
   ```
   Doe hetzelfde bij **Confirm signup** (voor nieuwe gebruikers).
5. **Project Settings → API** (of de knop **Connect**): kopieer de **Project URL** (`https://xxxx.supabase.co`) en de **anon / publishable key**. Die sleutel mag openbaar in de app staan; de beveiliging zit in de database-regels.
6. Geef die twee waarden aan Claude, of vul ze zelf in `js/config.js` in.

Deel nooit de **service_role / secret** key, en zet hem nooit in de app.

## Gekoppeld aan GitHub Pages

`js/config.js` bevat de publieke projectconfiguratie voor `suwixbbpjvitlvbcfawe`.
Deze app is gewone HTML/JavaScript: `NEXT_PUBLIC_*`-variabelen worden hier niet
automatisch ingelezen. Er is geen buildstap nodig.

De e-mailcode-flow gebruikt `signInWithOtp` (bestaande en nieuwe gebruikers) en
`verifyOtp` met `type: 'email'`. Zowel **Magic Link** als **Confirm signup** moet
`{{ .Token }}` tonen. SMTP-gegevens blijven uitsluitend in Supabase.
Zie de [Supabase-handleiding](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Controle na publicatie:

1. Open `https://koen-gpc.github.io/stride-run/#/friends` en vraag een code aan.
2. Controleer inbox/spam en voer de code in dezelfde app in. Test ook een
   onjuiste code; daarna moet opnieuw invoeren mogelijk blijven.
3. Vul bij een nieuw account een naam in. Controleer een groep aanmaken,
   uitnodigen en aanmelden met een tweede account.
4. Herlaad de app: je moet ingelogd blijven. Test uitloggen en opnieuw inloggen.
5. Controleer dit ook via de geïnstalleerde telefoonapp. Heropen de app voor de
   nieuwe offlinecache; verwijder geen browsergegevens, daarin staan je runs.

Geautomatiseerde regressietests: `node --test` (geen extra pakketten nodig).
Echte mailbezorging, SMTP/templates en toegang met twee accounts vragen een
praktijktest; deze zijn niet bewezen door de geautomatiseerde tests.

**Let op, e-maillimiet:** de ingebouwde mailer van Supabase verstuurt maar een paar mails per uur. Voor een kleine vriendengroep is dat genoeg als niet iedereen tegelijk inlogt. Wordt het te krap, koppel dan bij **Authentication → Emails → SMTP Settings** een gratis mailer (bijv. Resend of Brevo).

# Mamaschine

Weil Mama nicht mehr mitwäscht. Waschmaschine und Wäschehaufen fotografieren (oder eintippen), Trommel dreht, Schritt-für-Schritt-Anleitung kommt.

## Aufbau

- `public/` – die Website (index.html, app.js, style.css, werben.html, danke.html)
- `netlify/functions/analyze.mts` – Foto-Analyse über die Netlify AI Gateway (Claude), Pfad `/api/analyze`, max. 8 Anfragen pro Minute und IP
- `netlify/functions/status.mts` – sagt der Seite, ob die Foto-KI aktiv ist (`/api/status`)
- `netlify.toml` – Build-Einstellungen

Ohne aktive KI funktioniert die Seite trotzdem: Maschine eintippen und „Ohne Foto“ nutzen eine eingebaute Regel-Logik.

## Deploy

Netlify-Projekt: `mamaschine` (mamaschine.netlify.app, künftig mamaschine.net), Formulare sind aktiviert.

**Variante A – Git (empfohlen):** Repo zu GitHub pushen, in Netlify unter Project configuration → Build & deploy → Link repository verbinden. Jeder Push deployt automatisch.

**Variante B – Drag & Drop:** Eingeloggt auf app.netlify.com → Projekt `mamaschine` → Deploys → Ordner hineinziehen.

**Variante C – CLI:**
```
npm install
npx netlify-cli deploy --prod --site 58800fe9-fef6-496d-bfe0-d45a9e5663ca
```

## Nach dem ersten Deploy

1. **Foto-KI:** Die AI Gateway startet automatisch nach dem ersten Production-Deploy auf einem credit-basierten Netlify-Plan. Ist der Plan älter, alternativ eine Umgebungsvariable `ANTHROPIC_API_KEY` (Scope: Functions) setzen und neu deployen.
2. **Werbe-Formular an ads@mamaschine.net:** Netlify → Projekt → Forms → Form notifications → Add notification → Email notification → Formular `werbung` → `ads@mamaschine.at`.
3. **Kosten im Blick:** Unter Usage die AI-Credits beobachten; die Funktion ist bereits pro IP gedrosselt.

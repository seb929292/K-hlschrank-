# Unser Kühlschrank

Gemeinsame Vorrats-App für den Haushalt: Bestand mit Ablauf-Ampel, Live-Barcode-Scanner (wie an der Kasse) mit Produktdaten von Open Food Facts, lose Ware per Antippen oder Text.

**Version 0.2:** Live-Scanner, MHD schnell eintippen (z. B. 1203), Einkaufsliste mit Nachkauf-Vorschlägen und Laden pro Produkt, Warnung bei Doppelkäufen. Daten liegen noch im Browser des jeweiligen Handys. Als Nächstes: gemeinsame Datenbank (Supabase) mit Live-Sync.

## Benutzen
Die Seite im Handy-Browser öffnen, Kamera erlauben, dann über das Browser-Menü „Zum Startbildschirm hinzufügen“.

## Technik
Reines HTML/CSS/JavaScript ohne Build-Schritt. Barcode-Erkennung mit [html5-qrcode](https://github.com/mebjas/html5-qrcode). Veröffentlicht über GitHub Pages.

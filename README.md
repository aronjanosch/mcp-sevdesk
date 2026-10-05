# mcp-sevdesk

Ein MCP (Model Context Protocol) Server für die sevdesk API. Ermöglicht die Integration von sevdesk-Buchhaltungsfunktionen in Claude und andere MCP-kompatible Anwendungen.

## Features

- **Kontakte**: Erstellen, lesen, aktualisieren und löschen von Kontakten (Kunden, Lieferanten, Partner)
- **Rechnungen**: Anlegen, auflisten, abrufen, als PDF speichern, per E-Mail versenden, buchen (inkl. Zahlungsabgleich mit Bank-Transaktionen), festschreiben und stornieren
- **Angebote und Gutschriften**: Lesender Zugriff
- **Belege (Voucher)**: Anlegen, bearbeiten und buchen von Eingangsrechnungen und Ausgaben, inkl. Dokument-Upload und Buchungskonto-Ermittlung
- **Bankkonten**: Bankkonten, Kontostände und Transaktionen verwalten
- **Read-only-Modus**: Optional nur lesende Tools exponieren
- **Artikel**: Verwalten von Produkten und Dienstleistungen

## Installation

```bash
npm install
npm run generate-types
npm run build
```

## Konfiguration

Setze die Umgebungsvariable `SEVDESK_API_TOKEN` mit deinem sevdesk API-Token:

```bash
export SEVDESK_API_TOKEN="dein-32-zeichen-hex-token"
```

Den API-Token findest du in sevdesk unter: Einstellungen → Benutzer → API-Token

## Verwendung

### Als MCP-Server

Füge den Server zu deiner Claude Desktop Konfiguration hinzu (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sevdesk": {
      "command": "node",
      "args": ["/pfad/zu/mcp-sevdesk/dist/index.js"],
      "env": {
        "SEVDESK_API_TOKEN": "dein-api-token"
      }
    }
  }
}
```

### Read-only-Modus

Für reine Auswertungen und Recherche lässt sich der Server so starten, dass er **nur lesende Tools**
registriert. Alles, was Daten anlegen, ändern, löschen, versenden oder festschreiben könnte, ist
dann für den Client gar nicht sichtbar:

```bash
SEVDESK_READONLY=1 npm start      # oder: node dist/index.js --read-only
```

In der Claude-Desktop-Konfiguration also `"env": { "SEVDESK_API_TOKEN": "...", "SEVDESK_READONLY": "1" }`
setzen oder `"--read-only"` zu `args` hinzufügen. Ein zusätzlich eingeschränkter API-Token in sevdesk
bleibt die sicherste Variante, der Modus ist die zweite Schutzschicht.

### Direkt ausführen

```bash
SEVDESK_API_TOKEN="dein-token" npm start
```

## Verfügbare Tools

Jedes Tool trägt MCP-Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`), damit
Clients gezielt vor Löschen, Stornieren, Festschreiben und Versenden nachfragen können.
**R** = lesend, **W** = schreibend (korrigierbar), **D** = destruktiv (nicht rückgängig zu machen).

### Kontakte

| Tool | | Beschreibung |
|------|---|-------------|
| `list_contacts` | R | Kontakte auflisten |
| `get_contact` | R | Einzelnen Kontakt abrufen |
| `get_next_customer_number` | R | Nächste freie Kundennummer |
| `create_contact` | W | Neuen Kontakt erstellen |
| `update_contact` | W | Kontakt aktualisieren |
| `delete_contact` | D | Kontakt löschen |

### Rechnungen

| Tool | | Beschreibung |
|------|---|-------------|
| `list_invoices` | R | Rechnungen auflisten (Status, Zeitraum, Kontakt) |
| `get_invoice` | R | Einzelne Rechnung abrufen |
| `get_invoice_pdf` | R | PDF abrufen, mit `outputPath` direkt als Datei speichern |
| `get_invoice_positions` | R | Positionen einer Rechnung |
| `get_positions_by_part` | R | Alle Verkäufe eines Artikels |
| `list_invoice_positions_for_timeframe` | R | Umsatz je Produkt in einem Zeitraum |
| `create_invoice` | W | Rechnung mit Positionen anlegen (Standard: Entwurf) |
| `update_invoice` | W | Rechnungsentwurf ändern (Kopf, Kunde, Datum, Positionen ändern/hinzufügen) |
| `create_invoice_from_order` | W | Rechnung aus Angebot/Auftrag erzeugen (auch Teil-/Abschlagsrechnung) |
| `create_invoice_reminder` | W | Mahnung zu einer überfälligen Rechnung erzeugen |
| `mark_invoice_as_sent` | W | Rechnung als versendet markieren |
| `book_invoice` | W | Zahlung buchen, optional mit Bank-Transaktion verknüpfen |
| `reset_invoice_to_draft` / `reset_invoice_to_open` | W | Status zurücksetzen |
| `send_invoice_by_email` | D | Rechnung per E-Mail versenden |
| `cancel_invoice` | D | Rechnung stornieren (erzeugt Stornorechnung) |
| `enshrine_invoice` | D | Rechnung festschreiben |

### Angebote/Aufträge und Gutschriften

| Tool | | Beschreibung |
|------|---|-------------|
| `list_orders`, `get_order`, `get_order_positions` | R | Angebote und Aufträge |
| `list_credit_notes`, `get_credit_note`, `get_credit_note_positions` | R | Gutschriften |
| `create_credit_note_from_invoice` | W | Gutschrift zu einer Rechnung anlegen |

### Export (DATEV)

| Tool | | Beschreibung |
|------|---|-------------|
| `start_datev_export` | W | DATEV-CSV-Export für einen Zeitraum starten (schreibt Belege nicht fest) |
| `get_export_job_download_info` | R | Download-Link des Exports abrufen (erst verfügbar, wenn der Job fertig ist) |

### Belege (Voucher)

| Tool | | Beschreibung |
|------|---|-------------|
| `list_vouchers` | R | Belege auflisten (Status, Zeitraum, Lieferant, Beschreibung) |
| `get_voucher` | R | Einzelnen Beleg abrufen |
| `get_voucher_positions` | R | Belegpositionen abrufen |
| `upload_voucher_file` | W | Belegdatei hochladen (liefert den internen Dateinamen) |
| `create_voucher` | W | Neuen Beleg mit Positionen anlegen |
| `update_voucher` | W | Beleg im Entwurfsstatus aktualisieren |
| `book_voucher` | W | Zahlung buchen, optional mit Bank-Transaktion verknüpfen |
| `reset_voucher_to_draft` / `reset_voucher_to_open` | W | Status zurücksetzen |
| `enshrine_voucher` | D | Beleg festschreiben |

### Buchungskonten (Receipt Guidance)

Belegpositionen brauchen ein Buchungskonto. Dieses Tool liefert die gültigen Konten
inklusive der erlaubten Steuersätze — ohne es müsste das Modell Kontonummern raten.

| Tool | | Beschreibung |
|------|---|-------------|
| `get_receipt_guidance` | R | `scope`: `expense`, `revenue`, `all`, `account_number`, `tax_rule`; mit `search` filterbar |
| `get_bookkeeping_system_version` | R | Version des Buchhaltungssystems (1.0 vs. 2.0) |

### Belege anlegen

Ein Beleg entsteht in zwei Schritten, weil sevdesk die Datei getrennt vom Beleg entgegennimmt:

1. `upload_voucher_file` lädt die Datei hoch und gibt einen internen Dateinamen zurück.
2. `create_voucher` legt den Beleg an und hängt die Datei über `filename` an.

Das Buchungskonto (`accountingTypeId` für sevdesk-Update 1.0, `accountDatevId` für 2.0)
kommt aus den Receipt-Guidance (`get_receipt_guidance`). Pro Position wird nur **ein** Betrag angegeben:
`sum` gilt per Default als Bruttobetrag, mit `net: true` als Nettobetrag — der jeweils
andere Wert wird aus `taxRate` berechnet, damit Netto und Brutto nicht auseinanderlaufen
können.

```jsonc
// create_voucher
{
  "creditDebit": "D",          // D = Ausgabe
  "taxRule": "1",              // Umsatzsteuerpflichtige Umsätze
  "voucherDate": "01.08.2026",
  "supplierName": "Musterlieferant",
  "description": "RE-2026-0815",
  "filename": "f019bec36c65f5a0e7d2c63cc33f0681.pdf",
  "positions": [
    { "accountingTypeId": 27, "taxRate": 19, "sum": 119.00, "comment": "Bürobedarf" }
  ]
}
```

`create_voucher` legt den Beleg per Default mit Status 100 (offen) an; mit `status: "50"`
entsteht ein Entwurf. sevdesk erlaubt Änderungen nur an Entwürfen — bei einem offenen oder
bezahlten Beleg also zuerst `reset_voucher_to_draft` bzw. `reset_voucher_to_open` aufrufen.

### Bankkonten

| Tool | | Beschreibung |
|------|---|-------------|
| `list_check_accounts`, `get_check_account`, `get_check_account_balance` | R | Bankkonten und Kontostand |
| `list_transactions`, `get_transaction` | R | Transaktionen (inkl. Filter `isBooked`) |
| `create_transaction`, `update_transaction` | W | Transaktion anlegen/ändern |
| `delete_transaction`, `enshrine_transaction` | D | Transaktion löschen/festschreiben |

### Artikel und Tags

| Tool | | Beschreibung |
|------|---|-------------|
| `list_parts`, `get_part`, `get_part_stock` | R | Artikel und Lagerbestand |
| `create_part`, `update_part` | W | Artikel anlegen/ändern |
| `list_tags`, `get_tag`, `list_tag_relations` | R | Tags |
| `create_tag`, `update_tag` | W | Tag anlegen/umbenennen |
| `delete_tag` | D | Tag löschen |

## Verhalten der Tools

- **Pagination**: Listen-Tools liefern standardmäßig 50 Einträge (max. 500) und geben
  `hasMore` sowie `nextOffset` zurück. Mit `fields` lassen sich die Felder je Eintrag einschränken.
- **Datumsangaben**: Filter und Buchungsdaten akzeptieren `YYYY-MM-DD`, `DD.MM.YYYY` oder einen
  Unix-Timestamp. Reine Datumsangaben gelten in Europe/Berlin, ein `endDate` schließt den ganzen Tag ein.
- **Kompakte Antworten**: Leere Felder (`null`, `""`, `[]`) werden entfernt, das JSON ist nicht eingerückt.
- **Fehler**: API-Fehler kommen als lesbare Meldung mit HTTP-Status zurück. Der Client nutzt ein
  Timeout (30 s) und wiederholt bei `429` (alle Methoden) sowie bei `5xx`/Netzwerkfehlern (nur `GET`)
  mit exponentiellem Backoff.

## Entwicklung und Tests

```bash
npm run check              # Typecheck + Unit-Tests (offline, simulierte API)
npm run test:integration   # Integrationstest gegen eine echte sevdesk-Instanz
```

Die Unit-Tests brauchen keinen Token und verwenden nur erfundene Beispieldaten. Der
Integrationstest ist opt-in und **nur für einen Testmandanten** gedacht:

```bash
# nur lesend
SEVDESK_TEST_TOKEN=... npm run test:integration

# zusätzlich Schreibzyklus (legt einen Testkontakt und einen Rechnungsentwurf an)
SEVDESK_TEST_TOKEN=... SEVDESK_TEST_ALLOW_WRITE=1 SEVDESK_TEST_CONTACT_PERSON_ID=<sevdesk-User-ID> \
  npm run test:integration
```

Die Tests prüfen nur die Struktur der Antworten und geben keine Inhalte aus. Rechnungsentwürfe lassen
sich per API nicht löschen und bleiben im Testmandanten liegen.

## API-Referenz

Dieser Server basiert auf der offiziellen sevdesk API v1. Weitere Informationen zur API findest du in der [sevdesk API-Dokumentation](https://api.sevdesk.de/).

## Lizenz

MIT

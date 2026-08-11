# mcp-sevdesk

Ein MCP (Model Context Protocol) Server für die sevdesk API. Ermöglicht die Integration von sevdesk-Buchhaltungsfunktionen in Claude und andere MCP-kompatible Anwendungen.

## Features

- **Kontakte**: Erstellen, lesen, aktualisieren und löschen von Kontakten (Kunden, Lieferanten, Partner)
- **Rechnungen**: Auflisten, abrufen, als PDF exportieren, per E-Mail versenden, buchen und stornieren
- **Belege (Voucher)**: Anlegen, bearbeiten und buchen von Eingangsrechnungen und Ausgaben, inkl. Dokument-Upload und Buchungskonto-Ermittlung
- **Bankkonten**: Verwalten von Bankkonten und Transaktionen
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

### Direkt ausführen

```bash
SEVDESK_API_TOKEN="dein-token" npm start
```

## Verfügbare Tools

### Kontakte

| Tool | Beschreibung |
|------|-------------|
| `list_contacts` | Alle Kontakte auflisten |
| `get_contact` | Einzelnen Kontakt abrufen |
| `create_contact` | Neuen Kontakt erstellen |
| `update_contact` | Kontakt aktualisieren |
| `delete_contact` | Kontakt löschen |

### Rechnungen

| Tool | Beschreibung |
|------|-------------|
| `list_invoices` | Alle Rechnungen auflisten |
| `get_invoice` | Einzelne Rechnung abrufen |
| `get_invoice_pdf` | Rechnung als PDF abrufen |
| `send_invoice_by_email` | Rechnung per E-Mail versenden |
| `mark_invoice_as_sent` | Rechnung als versendet markieren |
| `book_invoice` | Rechnung als bezahlt buchen |
| `cancel_invoice` | Rechnung stornieren |

### Belege (Voucher)

| Tool | Beschreibung |
|------|-------------|
| `list_vouchers` | Alle Belege auflisten |
| `get_voucher` | Einzelnen Beleg abrufen |
| `create_voucher` | Neuen Beleg mit Positionen anlegen |
| `update_voucher` | Beleg im Entwurfsstatus aktualisieren |
| `book_voucher` | Beleg als bezahlt buchen |
| `get_voucher_positions` | Belegpositionen abrufen |
| `upload_voucher_file` | Belegdatei hochladen (liefert den internen Dateinamen) |
| `reset_voucher_to_draft` | Beleg zurück auf Entwurf setzen (zum Bearbeiten) |
| `reset_voucher_to_open` | Bezahlten Beleg zurück auf offen setzen |

### Buchungskonten (Receipt Guidance)

Belegpositionen brauchen ein Buchungskonto. Diese Tools liefern die gültigen Konten
inklusive der erlaubten Steuersätze — ohne sie müsste das Modell Kontonummern raten.

| Tool | Beschreibung |
|------|-------------|
| `get_receipt_guidance_for_expense` | Buchungskonten für Ausgaben (creditDebit=D) |
| `get_receipt_guidance_for_revenue` | Buchungskonten für Einnahmen (creditDebit=C) |
| `list_receipt_guidance_accounts` | Alle Buchungskonten |
| `get_receipt_guidance_by_account_number` | Info zu einer DATEV-Kontonummer |
| `get_receipt_guidance_by_tax_rule` | Konten zu einer Steuerregel, z. B. `USTPFL_UMS_EINN` |
| `get_bookkeeping_system_version` | Version des Buchhaltungssystems (1.0 vs. 2.0) |

### Belege anlegen

Ein Beleg entsteht in zwei Schritten, weil sevdesk die Datei getrennt vom Beleg entgegennimmt:

1. `upload_voucher_file` lädt die Datei hoch und gibt einen internen Dateinamen zurück.
2. `create_voucher` legt den Beleg an und hängt die Datei über `filename` an.

Das Buchungskonto (`accountingTypeId` für sevdesk-Update 1.0, `accountDatevId` für 2.0)
kommt aus den Receipt-Guidance-Tools. Pro Position wird nur **ein** Betrag angegeben:
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

| Tool | Beschreibung |
|------|-------------|
| `list_check_accounts` | Alle Bankkonten auflisten |
| `get_check_account` | Einzelnes Bankkonto abrufen |
| `get_check_account_balance` | Kontostand abrufen |
| `list_transactions` | Transaktionen auflisten |
| `get_transaction` | Einzelne Transaktion abrufen |
| `create_transaction` | Neue Transaktion erstellen |

### Artikel

| Tool | Beschreibung |
|------|-------------|
| `list_parts` | Alle Artikel auflisten |
| `get_part` | Einzelnen Artikel abrufen |
| `create_part` | Neuen Artikel erstellen |
| `update_part` | Artikel aktualisieren |
| `get_part_stock` | Lagerbestand abrufen |

## API-Referenz

Dieser Server basiert auf der offiziellen sevdesk API v1. Weitere Informationen zur API findest du in der [sevdesk API-Dokumentation](https://api.sevdesk.de/).

## Lizenz

MIT

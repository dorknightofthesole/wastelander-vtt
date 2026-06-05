# Character sheet PDF templates (user-installed)

Wastelander does **not** ship Modiphius fillable PDFs. Copy your licensed sheets here after installing the module.

**Foundry data path (typical):**

`Data/modules/wastelander/assets/sheets/`

## Required files

| Actor type | Filename |
|------------|----------|
| Human (`character`) | `FO2d20-Human-Character-Sheet_v002m.pdf` |
| Robot (`robot`) | `FO2d20-Robot-Character-Sheet_v002m.pdf` |

Until the correct PDF is present, **Export to PDF** is grayed out on the actor sheet menu and shows an installation reminder.

**Parse PDF** reads a filled human or robot character sheet you upload and overwrites matching data on the open actor (no template file required for import).

## Dev: list AcroForm field names

```bash
npm run list-pdf-fields
# or with a local copy:
node scripts/list-pdf-fields.mjs /path/to/FO2d20-Human-Character-Sheet_v002m.pdf
```

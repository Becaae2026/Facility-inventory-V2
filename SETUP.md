# Facility Inventory Dashboard — Setup (rebuild, Aug 2026)

Package contents:

| File | Purpose |
|---|---|
| `Code.gs` | Apps Script backend — bound web app that reads/writes the Google Sheet |
| `index.html` | The dashboard (single file, no CDNs) |
| `config.js` | Web App URL + settings — separate so dashboard updates never wipe it |
| `chart.umd.js` | Chart.js v4.5.1 served locally (office network blocks CDNs) |

The Google Sheet (`1HhgP1A5qcnc4yD_7ubGpb3gZQlqIE9VHBMhfNtLlVE8`) stays the single
source of truth. Tab names and row layouts must stay as they are:
**Item Master** (data from row 3), **Stock IN** / **Stock OUT** (data from row 3),
**Branches** (data from row 5), **Vendors** (data from row 4), **Lists** (data from row 4).
The **Audit Log** tab is created automatically on first write.

---

## 1 · Deploy the Apps Script backend

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Delete any old code in `Code.gs` and paste the new `Code.gs` from this package.
3. **Deploy → New deployment → Web app**
   - Description: `Facility Inventory API v2`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorize when prompted, then copy the Web App URL (ends in `/exec`).

> Redeploying later? Use **Deploy → Manage deployments → Edit → New version** so the
> URL stays the same and `config.js` doesn't need changing.

## 2 · Point the dashboard at the backend

Open `config.js` and paste the URL:

```js
WEB_APP_URL: "https://script.google.com/macros/s/XXXX/exec",
```

## 3 · Publish on GitHub Pages

In the repo `Becaae2026/Facility-inventory-`, replace / upload:

- `index.html`
- `config.js` (with your URL pasted in)
- `chart.umd.js`
- keep the existing `BECAAE_LOGO.jpg` in the repo root (header + printed reports use it)

Pages will serve it at `https://becaae2026.github.io/Facility-inventory-/` within a minute
or two. Hard-refresh (Ctrl+F5) after uploading.

## 4 · Daily backup (5-year retention)

1. In the Apps Script editor, open **Triggers** (clock icon) → **Add trigger**.
2. Function: `dailyBackup` · Event source: **Time-driven** · **Day timer** · e.g. 1–2 am.

Each run copies the whole workbook to the Drive folder **Facility Inventory Backups**
(`Facility Inventory Backup YYYY-MM-DD`) and trashes copies older than 1825 days.

## 5 · Verify

1. Open the dashboard → Settings → **Test connection** (should show "API is live").
2. Post a test receipt in **Stock In** → check the row appears in the Sheet's Stock IN tab
   with a GRN number, ACTIVE status, and an Audit Log entry.
3. **Void** it from the dashboard → status flips to VOID in the Sheet; the row is never deleted.
4. Edit a quantity directly in the Sheet → press **⟳ Refresh** in the dashboard →
   balances update (two-way sync: dashboard writes instantly, Sheet edits arrive on
   refresh / auto-refresh every 120 s by default).

## Conventions the system enforces

- Nothing is ever deleted — cancellation sets **Status = VOID**.
- Stock Out is blocked server-side (and client-side) if the requested quantity exceeds
  the live balance.
- Document numbers: receipts `GRN-00001…`, issues `ISS-00001…`, assigned by the backend.
- Every write lands in the **Audit Log** tab with timestamp, user, action, and details.
- Financial-year reports run Aug–Jul (FY starts 01-Aug-2026), calendar-year and monthly
  reports also available, all printable with the BEC AAE letterhead and exportable to CSV.

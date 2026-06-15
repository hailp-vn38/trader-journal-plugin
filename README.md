# Trader Journal

Trader Journal is an Obsidian plugin for recording backtest trades in Markdown notes. It stores one daily journal file per symbol and renders each trade JSON block as a readable card in Reading View.

## Features

- Add backtest trades from an Obsidian modal.
- Store one file per symbol per day.
- Configure journal folder, symbols, and timeframes in settings.
- Track side, setup, timeframe, result, RR, tags, images, notes, opened time, closed time, and holding time.
- Auto-calculate holding time from opened and closed timestamps.
- Paste image files directly into the Images input; pasted images are saved to the vault.
- Render trade JSON blocks as cards in Reading View.
- Click a rendered image to open a full-screen image preview.
- Recalculate daily statistics automatically when a journal note changes.
- Recalculate the active note manually with the command **Recalculate current stats**.

## Storage Layout

Journal files are created under the configured journal folder:

```text
Trading/Backtests/
  BTC/
    2026/
      06/
        2026-06-15.md
  _attachments/
```

The path format is:

```text
{journalFolder}/{symbol}/{year}/{month}/{date}.md
```

Example:

```text
Trading/Backtests/BTC/2026/06/2026-06-15.md
```

## Trade Blocks

Trades are stored as fenced JSON code blocks:

````markdown
```trader-journal-trade
{
	"schemaVersion": 1,
	"id": "20260412234400-BTC-a1b2c3",
	"symbol": "BTC",
	"side": "long",
	"setup": "Breakout",
	"timeframe": "1m",
	"result": "win",
	"rr": 1,
	"tags": ["trend"],
	"images": [
		{
			"type": "file",
			"value": "Trading/Backtests/_attachments/BTC-20260615-102030-a1b2c3.png"
		}
	],
	"notes": "Followed the plan.",
	"opened_at": "2026-06-15T09:30:00+07:00",
	"closed_at": "2026-06-15T10:05:00+07:00",
	"holding_time": 35
}
```
````

The JSON block is the source of truth. The summary table and frontmatter statistics are regenerated from the trade blocks.

## Commands

- **Add backtest trade**: Opens the trade entry modal.
- **Recalculate current stats**: Rebuilds the summary and frontmatter statistics for the active journal note.

## Settings

- **Journal folder**: Root folder for generated journal files.
- **Symbols**: Symbols shown in the trade modal.
- **Timeframes**: Timeframes shown in the trade modal.

## Development

Install dependencies:

```bash
npm install
```

Run development build in watch mode:

```bash
npm run dev
```

Run production build:

```bash
npm run build
```

Run lint:

```bash
npm run lint
```

## Release Artifacts

For an Obsidian plugin release, attach these files:

- `manifest.json`
- `main.js`
- `styles.css`

The plugin ID is `trader-journal-plugin`.

# LifeLedger Agent Notes

## Project Shape

- This is an Obsidian plugin with the TypeScript source in `main.ts`.
- Obsidian loads the bundled runtime file `main.js`, so behavior changes must be reflected in both `main.ts` and `main.js` unless the build step is known to have regenerated `main.js`.
- Styles live in `styles.css`; plugin metadata lives in `manifest.json`.
- There is no `src/` directory in the current repository layout.
- See `docs/current-behavior.md` for the human-facing summary of current layout and balance rules.

## Balance Rules

- Activity wallet default initial amount is `0`, not `1500`.
- Legacy settings that still contain the old `1500` default are migrated to `0` only when no ledger records exist.
- Ledger records with type `initial` may use a negative amount to reduce a wallet balance.
- Income and expense records must remain positive amounts; `initial` records must not be `0`.

## Verification

- Run TypeScript checking with:

```powershell
.\node_modules\.bin\tsc.cmd .\main.ts --noEmit --skipLibCheck --moduleResolution node --target ES2018 --lib DOM,ES2018
```

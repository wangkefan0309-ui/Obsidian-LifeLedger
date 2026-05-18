# Current Behavior Notes

## Repository Layout

The current repository does not use a `src/` directory. The active plugin files are:

```text
main.ts        # TypeScript source
main.js        # bundled file loaded by Obsidian
styles.css     # plugin styles
manifest.json  # Obsidian plugin manifest
```

When changing plugin behavior, keep `main.ts` and the Obsidian-loaded `main.js` in sync.

## Balance Rules

- The activity wallet default initial amount is `0`.
- If an older saved setting still contains the previous `1500` default and no ledger records exist, the plugin migrates it to `0`.
- `initial` records may use negative amounts to reduce a wallet balance.
- Income and expense records must remain positive amounts.
- `initial` records cannot be `0`.

## Verification

Run TypeScript checking with:

```powershell
.\node_modules\.bin\tsc.cmd .\main.ts --noEmit --skipLibCheck --moduleResolution node --target ES2018 --lib DOM,ES2018
```


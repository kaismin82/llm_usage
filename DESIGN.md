# LLM Usage Glance additions

## 1. Atmosphere & Identity
Preserve the existing compact usage dashboard and its muted, layered surfaces.
Custom providers extend the settings cards and popup cards; built-in provider styling stays unchanged.

## 2. Color
Options reuse `--color-bg`, `--color-surface`, `--color-border`, `--color-text`,
`--color-text-secondary`, `--color-text-muted`, `--color-primary`,
`--color-success`, `--color-warning` and `--color-danger` from `src/options/style.css`.
Popup additions reuse `--bg`, `--surface`, `--border`, `--text`, `--text-2`,
`--text-3`, `--accent` and the existing status/tone ramps from `src/popup/style.css`.
No new palette or changes to built-in provider colors are needed.

## 3. Typography
Reuse the existing Pretendard/system sans stack and options monospace stack.
Options use the existing 11/13/14/16/24px token scale.
Popup names, values and metadata retain existing compact 12/13/13.5px styles.
Long custom names and paths wrap without increasing the provider name scale.

## 4. Spacing & Layout
Options retain the 680px maximum width, 4px spacing scale and 600px mobile breakpoint.
Custom configuration owns a separate section after built-in providers and saves independently.
The document owns options scrolling; the existing sticky footer continues to save only built-in settings.
Popup retains its 460px extension surface and 600px scroll limit.
Custom cards appear below built-in summaries; arbitrary provider counts scroll rather than hiding data.

## 5. Components
- Settings card: reuse `.card`, `.card-header`, `.card-title-row`, `.provider-fields`.
  States are saved, editing, disabled, testing, empty and error.
- Labeled field: reuse `.field`, `.field-label`, `.input`, `.select`.
  Inputs are wrapped in labels and use password controls for API keys.
- Action cluster: reuse `.card-actions`, `.btn`, `.btn-save`, `.btn-danger`.
  Add/save/edit/test/delete are separate controls; busy controls are disabled.
- Status: reuse `.status-chip` and `.error-text`; async results use an ARIA live region.
- Popup card: reuse `.card`, `.card-h`, `.name`, `.chip`, `.bar`, existing tone ramps.
  Custom rows use flexible wrapping for arbitrary labels and amounts.
- All new controls retain native keyboard operation and explicit focus-visible rings.
- New custom-only selectors stay scoped; no existing selector is restyled.

## 6. Motion & Interaction
Reuse the existing 150/200ms button feedback. No entrance effects or decorative motion.
Loading is visible immediately; completion follows the actual background response.
Edits survive unrelated storage updates. Test and save do not overwrite built-in settings.
New custom bars do not add layout animation; reduced-motion mode respects native controls.

## 7. Depth & Surface
Reuse existing mixed border, subtle gradient and shadow card treatment.
Options radii remain 6/10/14px; popup radii remain 8/12px.
Custom enabled state uses a checkbox and status text, not a new accent border.

## 8. Accessibility & Accepted Debt
Every added field has a label, actions have meaningful names and results are announced.
Numeric values and percentage bars retain text alternatives.
Validate options at 375/768/1280px and popup at its real 460px width.
The existing popup is fixed-width and existing UI suites use legacy timing waits.
Those pre-existing behaviors are outside this additive change.

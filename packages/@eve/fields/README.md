# @eve/fields

HeroUI-based field renderer for Eve OS apps. **Canonical source:** [`synap-app/packages/core/heroui-fields`](../../../../synap-app/packages/core/heroui-fields/). This mirror exists because hestia-cli is a separate pnpm workspace; keep the two in sync until the package is published to npm.

## What it provides

One `<HeroField>` component renders **any** entity property with the right HeroUI input:

| type | input |
|------|-------|
| `text` / `email` / `phone` / `url` | inline-edit text |
| `number` / `currency` / `percent`  | formatted numeric input |
| `date` | calendar popover |
| `select` / `status` | colored-chip dropdown |
| `multi-select` / `tags` | chip list with searchable popover |
| `entity` / `multi-entity` | search-and-link with avatars |
| `boolean` | switch |
| `richtext` | auto-growing textarea |

Three layout variants:
- `inline` — sidebar row (icon + value)
- `card` — engagement-style stacked card (label on top)
- `row` — form-style label-left value-right

Seamless read↔write transitions handled internally by each cell.

## Usage

```tsx
import { HeroField, HeroFieldList } from "@eve/fields";

<HeroFieldList
  variant="card"
  layout="grid"
  columns={2}
  fields={[
    { id: "status", type: "status", label: "Status", value: s, options, onChange },
    { id: "due",    type: "date",   label: "Due",    value: d, onChange },
    { id: "value",  type: "currency", label: "Value", value: v, currency: "USD", onChange },
  ]}
/>
```

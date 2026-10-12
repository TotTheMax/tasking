---
status: accepted
---

# Task detail Description truncation with expand

The running-task detail page rendered the full task Description with no line cap, so a long description grew the box past the terminal height and scrolled the upper fields (Title, State, Assignee, …) off-screen. We fix this by capping the Description to 6 wrapped lines by default, showing an `… (N more lines)` marker, and letting the user press `e` to toggle to the full text and back.

Decisions confirmed in the TAS-26 grill (all answered "按推荐"): default collapse to 6 wrapped lines; `e` key toggles expand/collapse with a footer hint (`e expand` / `e collapse`); the expand state is not remembered — every detail entry and every render starts collapsed, so `enterDetail` resets it.

Alternatives considered: letting the whole detail box scroll (the activity-detail page already scrolls, but the running detail is a compact summary card and scrolling the whole card changes the mental model); truncating the description to a single line (loses too much context). Capping to a few wrapped lines with an expand toggle keeps the card compact while preserving full access to the text.

## Consequences

- `formatRunningDetailFromState` folds the Description to `DESCRIPTION_FOLD_LINES` (6) wrapped lines; long descriptions show the truncation marker and a footer hint by default.
- `e` in `detail-running` toggles `descExpanded`; the state is reset in `enterDetail`, so it never persists across tasks or render cycles.
- The retry-detail and snapshot render paths are unaffected (they do not render the Description).

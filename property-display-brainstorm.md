# Property Display Control: Brainstorming Problem

## Current State

My Obsidian plugin adds card view for Bases.

**Default Bases behavior:**
- Property display controlled via top-right toolbar button 'Properties'

**Plugin behavior:**
- Property display configured via custom view settings (accessed: view name → dropdown → settings → scroll to properties section)

## Desired State

Control property display via toolbar 'Properties' button (like default views) because:
- Easier UX
- Familiar pattern for Bases users
- No limit on number of properties shown (current: 4, considering: 10-12)

## Blockers

Two features prevent adopting default pattern:

### 1. Side-by-side pairing flexibility
Plugin allows ANY pair of properties side-by-side via toggles under even-numbered properties:
- 'Show property 1 and 2 side-by-side'
- 'Show property 3 and 4 side-by-side'

### 2. Mixed full-row + side-by-side layouts
Example configuration:
1. Prop 1: file tags
2. Prop 2: empty
3. Toggle "show 1 and 2 side-by-side": OFF
4. Prop 3: file path
5. Prop 4: mtime
6. Toggle "show 3 and 4 side-by-side": ON

Result: Tags occupy full row, followed by path+mtime side-by-side

## Question

**Is there a best-of-both-worlds solution that:**
- Show/hide properties via toolbar Properties menu
- Configure which properties display side-by-side vs. full-width (either as default with override option)

**Constraints:**
- Settings API for Bases views is limited (see: `/Users/username/Library/Mobile Documents/com~apple~CloudDocs/Obsidian stuff/Docs/obsidianmd repositories/obsidian-developer-docs`)

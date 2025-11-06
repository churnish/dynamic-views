- When I share console log filenames, look for them in `/Users/username/Desktop`
- I'm a programming novice who only knows JavaScript basics. Explain concepts clearly with minimal code. Default to conceptual explanations. Don't dumb it down. Only show code for:
  - Critical logic that can't be explained otherwise
  - High-level pseudo-code
  - Intuitive examples when introducing new patterns
- When needed, refer to this plugin's documentation at `/Users/username/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dynamic Views/DEV_DOCS` before implementing a solution.
- To view current plugin settings config: `/Users/username/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dynamic Views/.obsidian/plugins/dynamic-views/data.json`.
- Never remind me to restart Obsidian or reload plugin.
- Datacore repository: https://github.com/blacksmithgu/datacore
- Datacore repository issues: https://github.com/blacksmithgu/datacore/issues
- Datacore repository pull requests: https://github.com/blacksmithgu/datacore/pulls
- When Datacore/Obsidian documentation searches and web searches fail to yield useful results, and the answer would provide significant value, the final option is asking user to post to the Datacore  Discord server or Obsidian Discord server (whichever is more relevant) where community members may have the answer. In such case, compose a concise, natural-sounding and friendly message, add context if relevant.

## Commit protocol

You must ALWAYS follow each step in this protocol. You must NEVER skip any step in this protocol. Violation is critical error.

### Before modifying code

1. Ensure planned changes always fully and unfailingly adhere to both:
	a) Dynamic Views plugin policies (`/Users/username/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dynamic Views/DEV_DOCS/Policies`). Note: if planned changes violate policies, bring it up: the user shall decide whether to adhere to policy or to alter policy.
	b) Obsidian plugin guidelines (`/Users/username/Library/Mobile Documents/com~apple~CloudDocs/Obsidian stuff/obsidianmd repositories/obsidian-developer-docs/en/Plugins` and `/Users/username/Library/Mobile Documents/com~apple~CloudDocs/Obsidian stuff/obsidianmd repositories/obsidian-developer-docs/en/Obsidian October plugin self-critique checklist.md`).
2. Check `git status` (ignore files in .gitignore).
3. If uncommitted changes exist: `git add -A && git commit -m "[pre-change: description]"`.

### After modifying code

1. Run `npm run build && npx tsc --noEmit` (without `--skipLibCheck`) and fix ALL errors.
2. If both pass, commit using your response as the commit message:
   - Copy your response outlining the code changes
   - Omit any tangential conversation parts
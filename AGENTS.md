# Publishing rules

- Only the site owner, Natali, selects which prototype is public.
- Agents must never switch the live version, change `site_config.current_version`, or use the gallery's «Сделать текущей» control.
- Publishing a new prototype does not authorize switching the public site to it.
- Implement revisions in a new prototype file. Preserve existing prototypes and shared assets; give new assets distinct filenames so preparing or publishing a prototype cannot change the current public page.
- Push or deploy a new prototype only when the user explicitly authorizes publication. A local preview request does not authorize either action.
- Each prototype goes live as-is: titles, metadata and visible content must use final site wording, with no prototype/version/debug labels. Keep iteration notes only in the gallery.

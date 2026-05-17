# Assets

## Site assets

`prototypes/assets/` contains optimized files that are referenced by the HTML prototypes.

Keep this folder limited to assets that the site actually loads: compressed images, posters, logos, and videos prepared for the prototype.

## Brand sources

`source/brand/` contains original brand files and print exports:

- `logo/` — logo source and exports.
- `business-card/` — business card source, PDF, and print TIFFs.
- `thank-you-card/` — thank-you card PDFs and print TIFFs.

These files are tracked because they are the source of truth for the visual identity.

## Raw media

`source/media/natalija-originals/` contains raw photos and videos from Natalija.

This folder is intentionally ignored by git. When a raw file is needed on the site, make an optimized copy in `prototypes/assets/` and reference that optimized version from HTML.

## Root folder

The repo root should stay limited to project-level files such as `PROJECT.md`, `index.html`, `.gitignore`, and top-level folders.

If new source files are dropped into the root during work, move them into the matching `source/` or `prototypes/assets/` folder before committing.

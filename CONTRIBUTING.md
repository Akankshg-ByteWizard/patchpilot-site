# Contributing to PatchPilot Website

Thanks for improving the PatchPilot product site.

## Development

1. Clone the repo.
2. Serve locally:

```bash
python3 -m http.server 8080
```

3. Open http://localhost:8080

## Contribution Rules

- Keep all pages static and GitHub Pages compatible.
- Update links when moving files between root and `pages/`.
- Keep shared styles in `assets/css/styles.css`.
- Keep shared interactions in `assets/js/app.js`.
- Use relative URLs only.

## Pull Request Checklist

- Navigation works from `index.html` and every page in `pages/`.
- No broken stylesheet or script references.
- Layout remains responsive on mobile and desktop.
- README is updated when structure changes.

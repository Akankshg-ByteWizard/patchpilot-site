# PatchPilot Product Website

An open-source-first, multi-page product website for the Terminal AI Error Agent concept.

## Pages

- `index.html`: Homepage, positioning, trust, and reliability snapshot
- `pages/demo.html`: Interactive terminal prototype animation (failure -> fix -> retry)
- `pages/how-it-works.html`: Architecture flow and safety principles
- `pages/opensource.html`: Open-source roadmap and contribution direction
- `pages/docs.html`: Quick-start docs and GitHub Pages checklist

## Run locally

```bash
cd /Users/akankshgatla/Downloads/terminal-agent-mvp-site
python3 -m http.server 8080
```

Open:

- http://localhost:8080

## GitHub Pages Deployment

1. Push this folder to the root of your GitHub repository.
2. In repository settings, open Pages.
3. Set Source to `Deploy from a branch`.
4. Select `main` branch and `/ (root)` folder.
5. Save, then wait for GitHub Pages build and verify all page navigation links.

## Assets

- `assets/css/styles.css`: Shared visual design and responsive rules for all pages
- `assets/js/app.js`: Navigation state, metrics simulation, and demo prototype animation

## Repository Structure

```text
.
├── .github/workflows/deploy-pages.yml
├── assets/
│   ├── css/styles.css
│   ├── js/app.js
│   └── images/
├── docs/
│   └── terminal-agent-spec.md
├── pages/
│   ├── demo.html
│   ├── docs.html
│   ├── how-it-works.html
│   └── opensource.html
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── index.html
```

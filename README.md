# PatchPilot

PatchPilot is an open-source, terminal-native AI agent that turns command failures into safe, explainable fixes.

## Product Vision

PatchPilot helps developers recover from errors without leaving the terminal:

- Captures failed commands and execution context in real time.
- Suggests shell commands and patch diffs with clear reasoning.
- Requires explicit approval before impactful changes.
- Learns from successful fixes to resolve repeated incidents faster.

## Core Value

- Faster debugging loops for individual developers and teams.
- Safer automation through approval-first workflows.
- Open-source development model with transparent roadmap and contribution paths.

## Product Site Sections

- Home: Positioning, trust signals, and product snapshot.
- Live Demo: Interactive failure -> fix -> retry simulation.
- How It Works: Architecture, modules, and safety model.
- Open Source: Milestones, ownership areas, and community direction.
- Docs: Local preview and deployment workflow guidance.

## Local Preview

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

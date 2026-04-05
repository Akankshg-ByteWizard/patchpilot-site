const metricGrid = document.getElementById("metricGrid");
const eventStream = document.getElementById("eventStream");
const refreshBtn = document.getElementById("refreshBtn");
const terminalDemo = document.getElementById("terminalDemo");

const prototypeTerminal = document.getElementById("prototypeTerminal");
const stepList = document.getElementById("stepList");
const runScenarioBtn = document.getElementById("runScenarioBtn");
const toggleAutoBtn = document.getElementById("toggleAutoBtn");

const baseline = {
  fixSuccessRate: 88.2,
  lmcacheHitRate: 72.4,
  avgLatencyMs: 1260,
  vectorQueryMs: 29,
  sessionsToday: 182,
  autoApproved: 46,
  topError: "ModuleNotFoundError",
  rejectionRate: 5.7,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function markActiveNav() {
  const page = document.body.getAttribute("data-page");
  const links = document.querySelectorAll("[data-nav]");
  links.forEach((link) => {
    if (link.getAttribute("data-nav") === page) {
      link.classList.add("active");
    }
  });
}

function delta(base, variance) {
  const move = (Math.random() * variance * 2) - variance;
  return Math.max(0, base + move);
}

function nextSnapshot() {
  return {
    fixSuccessRate: Number(delta(baseline.fixSuccessRate, 3).toFixed(1)),
    lmcacheHitRate: Number(delta(baseline.lmcacheHitRate, 6).toFixed(1)),
    avgLatencyMs: Math.round(delta(baseline.avgLatencyMs, 320)),
    vectorQueryMs: Math.round(delta(baseline.vectorQueryMs, 14)),
    sessionsToday: Math.round(delta(baseline.sessionsToday, 12)),
    autoApproved: Math.round(delta(baseline.autoApproved, 5)),
    topError: Math.random() > 0.5 ? "ModuleNotFoundError" : "SyntaxError",
    rejectionRate: Number(delta(baseline.rejectionRate, 2).toFixed(1)),
  };
}

function toneForMetric(label, value) {
  if (label.includes("Latency") || label.includes("Query")) {
    return value < 1800 ? "good" : "warn";
  }
  if (label.includes("Success") || label.includes("Hit")) {
    return value > 70 ? "good" : "warn";
  }
  if (label.includes("Reject")) {
    return value < 10 ? "good" : "bad";
  }
  return "warn";
}

function renderMetrics(snapshot) {
  if (!metricGrid) {
    return;
  }

  const metrics = [
    { label: "Fix Success Rate", value: `${snapshot.fixSuccessRate}%`, trend: "High-confidence issue resolution" },
    { label: "Median Time to Fix", value: `${snapshot.avgLatencyMs} ms`, trend: "From failure to recommendation" },
    { label: "Memory Cache Hit Rate", value: `${snapshot.lmcacheHitRate}%`, trend: "Faster repeat incidents" },
    { label: "Vector Lookup Time", value: `${snapshot.vectorQueryMs} ms`, trend: "Top-3 similar fix retrieval" },
    { label: "Sessions Today", value: snapshot.sessionsToday, trend: "Developer command failures analyzed" },
    { label: "Safe Auto-Approvals", value: snapshot.autoApproved, trend: "Shell command fixes only" },
    { label: "Most Common Error", value: snapshot.topError, trend: "Useful for team training focus" },
    { label: "User Rejection Rate", value: `${snapshot.rejectionRate}%`, trend: "Lower means better trust" },
  ];

  metricGrid.innerHTML = metrics
    .map((metric) => {
      const numeric = parseFloat(String(metric.value));
      const tone = toneForMetric(metric.label, Number.isNaN(numeric) ? 0 : numeric);
      return `
        <article class="metric-card">
          <div class="metric-label">${metric.label}</div>
          <div class="metric-value">${metric.value}</div>
          <div class="metric-trend ${tone}">${metric.trend}</div>
        </article>
      `;
    })
    .join("");

  if (!eventStream) {
    return;
  }

  const now = new Date().toLocaleTimeString();
  const events = [
    `[${now}] command failure captured -> class ${snapshot.topError}`,
    `[${now}] memory lookup complete -> top-3 fixes in ${snapshot.vectorQueryMs}ms`,
    `[${now}] recommendation generated -> confidence ${Math.round(snapshot.fixSuccessRate)}%`,
    `[${now}] approval gate result -> ${snapshot.autoApproved} safe shell fix approvals`,
  ];

  eventStream.innerHTML = events.map((line) => `<p>${line}</p>`).join("");
}

function rotateDemo() {
  if (!terminalDemo) {
    return;
  }

  const samples = [
    [
      "$ python app.py",
      "ModuleNotFoundError: No module named 'fastapi'",
      "Suggestion: pip install fastapi",
    ],
    [
      "$ npm run build",
      "TS2304: Cannot find name 'UserProps'",
      "Suggestion: apply patch to component types",
    ],
    [
      "$ ./deploy.sh",
      "Permission denied: './deploy.sh'",
      "Suggestion: chmod +x ./deploy.sh",
    ],
  ];

  const sample = samples[Math.floor(Math.random() * samples.length)];
  terminalDemo.innerHTML = [
    `<p>${sample[0]}</p>`,
    `<p class="err">${sample[1]}</p>`,
    `<p class="ok">${sample[2]}</p>`,
  ].join("");
}

let isScenarioRunning = false;
let autoRunEnabled = true;

function setStepState(index, state) {
  if (!stepList) {
    return;
  }

  const items = [...stepList.querySelectorAll("li")];
  items.forEach((item, i) => {
    item.classList.remove("active", "done");
    if (i < index || (i === index && state === "done")) {
      item.classList.add("done");
    } else if (i === index && state === "active") {
      item.classList.add("active");
    }
  });
}

function pushTerminalLine(text, type = "info") {
  if (!prototypeTerminal) {
    return;
  }

  const line = document.createElement("div");
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  prototypeTerminal.appendChild(line);
  prototypeTerminal.scrollTop = prototypeTerminal.scrollHeight;
}

async function runScenario() {
  if (!prototypeTerminal || isScenarioRunning) {
    return;
  }

  isScenarioRunning = true;
  prototypeTerminal.innerHTML = "";

  const chosen = Math.random() > 0.5
    ? {
      command: "$ python app.py",
      error: "ModuleNotFoundError: No module named 'fastapi'",
      suggest: "pip install fastapi",
      retry: "$ python app.py\nServer started on http://127.0.0.1:8000",
    }
    : {
      command: "$ ./deploy.sh",
      error: "Permission denied: './deploy.sh'",
      suggest: "chmod +x ./deploy.sh",
      retry: "$ ./deploy.sh\nDeploy completed successfully",
    };

  setStepState(0, "active");
  pushTerminalLine(chosen.command, "cmd");
  await sleep(450);
  pushTerminalLine(chosen.error, "err");

  setStepState(0, "done");
  setStepState(1, "active");
  await sleep(420);
  pushTerminalLine("[agent] reading nearby source context (+/- 20 lines)", "info");

  setStepState(1, "done");
  setStepState(2, "active");
  await sleep(420);
  pushTerminalLine("[agent] vector search hit: 3 similar successful fixes", "info");

  setStepState(2, "done");
  setStepState(3, "active");
  await sleep(420);
  pushTerminalLine(`[agent] recommendation: ${chosen.suggest}`, "ok");

  setStepState(3, "done");
  setStepState(4, "active");
  await sleep(420);
  pushTerminalLine("[approval] apply suggestion? y", "info");

  setStepState(4, "done");
  setStepState(5, "active");
  await sleep(420);
  pushTerminalLine(`$ ${chosen.suggest}`, "cmd");
  await sleep(350);
  pushTerminalLine(chosen.retry, "ok");
  setStepState(5, "done");

  isScenarioRunning = false;
}

function initScenarioDemo() {
  if (!prototypeTerminal) {
    return;
  }

  if (runScenarioBtn) {
    runScenarioBtn.addEventListener("click", () => {
      runScenario();
    });
  }

  if (toggleAutoBtn) {
    toggleAutoBtn.addEventListener("click", () => {
      autoRunEnabled = !autoRunEnabled;
      toggleAutoBtn.textContent = `Auto Run: ${autoRunEnabled ? "On" : "Off"}`;
    });
  }

  runScenario();
  setInterval(() => {
    if (autoRunEnabled && !isScenarioRunning) {
      runScenario();
    }
  }, 9500);
}

function initMetrics() {
  if (!metricGrid) {
    return;
  }

  renderMetrics(nextSnapshot());
  setInterval(() => renderMetrics(nextSnapshot()), 12000);

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => renderMetrics(nextSnapshot()));
  }
}

function boot() {
  markActiveNav();
  initMetrics();
  initScenarioDemo();

  if (terminalDemo) {
    rotateDemo();
    setInterval(rotateDemo, 9000);
  }
}

boot();

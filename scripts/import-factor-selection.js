/**
 * 因子精选结果导入 — 将 Python GA 管线输出的最优因子组合,
 * 应用到平台的因子权重配置中。
 *
 * 用法:
 *   # 预览（不写入）
 *   node scripts/import-factor-selection.js --preview
 *
 *   # 应用到当前配置
 *   node scripts/import-factor-selection.js --apply
 *
 *   # 指定 GA 结果文件
 *   node scripts/import-factor-selection.js --input other_result.json
 *
 * 工作流: export-factor-ic.js → Python bridge.py → import-factor-selection.js
 */

const fs = require("fs");
const path = require("path");

const GENETIC_RESULT = path.join(__dirname, "..", "data", "factor_research", "genetic_result.json");
const FACTOR_FILE = path.join(__dirname, "..", "src", "factors.js");

function loadGeneticResult(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  return data.pareto_front || [];
}

function printTopCombos(paretoFront, n = 5) {
  console.log(`\nTop ${Math.min(n, paretoFront.length)} factor combinations:`);
  console.log("-".repeat(60));

  for (let i = 0; i < Math.min(n, paretoFront.length); i++) {
    const sol = paretoFront[i];
    const factors = sol.active_factors.join(", ");
    const f = sol.fitness;
    console.log(
      `#${i + 1} [${sol.n_active} factors] ${factors}`
    );
    console.log(
      `     IC=${f.composite_IC.toFixed(3)}  ` +
      `anti_redund=${f.anti_redundancy.toFixed(3)}  ` +
      `diversity=${f.diversity.toFixed(3)}  ` +
      `stability=${f.stability.toFixed(3)}`
    );
    console.log();
  }
}

function generateConfigPatch(paretoFront, topN = 3) {
  /** Generate suggested factor weight config from Pareto front. */
  const patches = [];

  for (let i = 0; i < Math.min(topN, paretoFront.length); i++) {
    const sol = paretoFront[i];
    const f = sol.fitness;

    // Equal weight among selected factors, scaled by composite IC
    const n = sol.active_factors.length;
    const baseWeight = 1.0;

    const weights = {};
    for (const name of sol.active_factors) {
      weights[name] = +(baseWeight / n).toFixed(2);
    }

    patches.push({
      rank: i + 1,
      name: `ga_opt_v${i + 1}`,
      description: `${n}-factor combination, IC=${f.composite_IC.toFixed(3)}`,
      factors: sol.active_factors,
      weights,
      metrics: f,
    });
  }

  return patches;
}

function main() {
  const args = process.argv.slice(2);
  const isPreview = args.includes("--preview") || !args.includes("--apply");
  const inputIdx = args.indexOf("--input");
  const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : GENETIC_RESULT;

  if (!fs.existsSync(inputPath)) {
    console.error(`[import] Genetic result not found: ${inputPath}`);
    console.error("[import] Run the pipeline first: node scripts/export-factor-ic.js && python python/factor_research/bridge.py -i data/factor_research/factor_ic.json");
    process.exit(1);
  }

  console.log(`[import] Loading: ${inputPath}`);
  const paretoFront = loadGeneticResult(inputPath);

  if (paretoFront.length === 0) {
    console.error("[import] No solutions in Pareto front. Pipeline may have failed.");
    process.exit(1);
  }

  console.log(`[import] ${paretoFront.length} Pareto-optimal solutions found`);

  printTopCombos(paretoFront);

  const patches = generateConfigPatch(paretoFront);

  console.log("Suggested config patches:");
  console.log(JSON.stringify(patches, null, 2));

  if (isPreview) {
    console.log("\n[import] PREVIEW mode — no changes applied.");
    console.log("[import] Run with --apply to apply the top-ranked config.");
    console.log("[import] Or manually update DEFAULT_FACTOR_WEIGHTS in src/factors.js.");
  } else {
    console.log("\n[import] Applying top-ranked config...");
    // Read current factors.js
    let source = fs.readFileSync(FACTOR_FILE, "utf-8");

    const top = patches[0];
    console.log(`[import] Selected: ${top.name} — ${top.description}`);

    // Generate the new weights block
    const weightsStr = JSON.stringify(top.weights, null, 4)
      .replace(/^\{/, "  {")
      .replace(/\}$/, "  }");

    // Replace DEFAULT_FACTOR_WEIGHTS in factors.js
    const weightsRegex = /const DEFAULT_FACTOR_WEIGHTS = \{[\s\S]*?\n\};/;
    const replacement = `const DEFAULT_FACTOR_WEIGHTS = ${JSON.stringify(top.weights, null, 2)};`;

    source = source.replace(weightsRegex, replacement);

    // Write backup
    const backup = FACTOR_FILE + `.bak.${Date.now()}`;
    fs.writeFileSync(backup, fs.readFileSync(FACTOR_FILE));
    console.log(`[import] Backup saved: ${backup}`);

    fs.writeFileSync(FACTOR_FILE, source);
    console.log(`[import] Updated ${FACTOR_FILE}`);
  }
}

main();
